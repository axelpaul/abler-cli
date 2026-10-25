import { realpathSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
const helperSources = [
	"login-command.ts",
	"login.ts",
	"session.ts",
	"client.ts",
];
/** Package root: the checkout or the installed package directory. */
export function packageRoot() {
	if (process.env.ABLER_SOURCE_DIR) return process.env.ABLER_SOURCE_DIR;
	// Running from source (git/bun install or checkout): src/ is next to this file.
	if (!import.meta.dir.startsWith("/$bunfs") && !/^[A-Z]:\\~BUN/.test(import.meta.dir))
		return dirname(import.meta.dir);
	// Compiled binary: expect a checkout next to the executable.
	return dirname(realpathSync(process.execPath));
}
/**
 * Playwright runs under Node in a small bundled helper. It is built on demand
 * (first `login` use, or when its sources are newer) so a plain
 * `bun add -g github:axelpaul/abler-cli` works without a lifecycle script.
 */
export async function ensureHelper(root = packageRoot()) {
	const helper = join(root, "dist", "login-helper.mjs");
	const sources = helperSources.map((f) => join(root, "src", f));
	const haveSources = sources.every(existsSync);
	const stale =
		!existsSync(helper) ||
		(haveSources &&
			sources.some((f) => statSync(f).mtimeMs > statSync(helper).mtimeMs));
	if (!stale) return helper;
	if (!haveSources)
		throw Error(
			"Browser login needs its helper (dist/login-helper.mjs). Set ABLER_SOURCE_DIR to an abler-cli checkout or install with bun add -g github:axelpaul/abler-cli.",
		);
	const result = await Bun.build({
		entrypoints: [join(root, "src", "login-command.ts")],
		target: "node",
		format: "esm",
		external: ["playwright-core"],
		outdir: join(root, "dist"),
		naming: "login-helper.mjs",
	}).catch((e: unknown) => ({
		success: false as const,
		logs: [e],
	}));
	if (!result.success || !existsSync(helper))
		throw Error(
			`Could not build the browser login helper in ${join(root, "dist")} (${String(result.logs[0] ?? "unknown error")}). Run bun run build:login there, or check write permissions.`,
		);
	return helper;
}
export async function browserAction(
	action: "start" | "verify" | "close",
	options: { phone?: string; code?: string; cdp?: string; headed?: boolean },
) {
	const helper = await ensureHelper();
	let child;
	try {
		child = Bun.spawn(
			[
				process.env.ABLER_NODE ?? "node",
				helper,
				action,
				options.cdp ?? "http://127.0.0.1:9334",
				...(options.headed ? ["--headed"] : []),
			],
			{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
		);
	} catch {
		throw Error(
			"Browser login needs Node.js (https://nodejs.org). Install it or set ABLER_NODE to the node executable.",
		);
	}
	child.stdin.write(JSON.stringify(options));
	child.stdin.end();
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) {
		let message = "Browser login helper failed";
		try {
			message = JSON.parse(err).error ?? message;
		} catch {}
		throw Error(message);
	}
	return JSON.parse(out);
}
