import { realpathSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
export async function browserAction(
	action: "start" | "verify" | "close",
	options: { phone?: string; code?: string; cdp?: string; headed?: boolean },
) {
	const base =
		process.env.ABLER_SOURCE_DIR ??
		(Bun.main.endsWith(".ts")
			? dirname(dirname(Bun.main))
			: dirname(realpathSync(process.execPath)));
	const helper = join(base, "dist", "login-helper.mjs");
	if (!existsSync(helper))
		throw Error(
			"Browser login needs its built helper. Run bun run build in the checkout and set ABLER_SOURCE_DIR if moved.",
		);
	const child = Bun.spawn(
		[
			process.env.ABLER_NODE ?? "node",
			helper,
			action,
			options.cdp ?? "http://127.0.0.1:9334",
			...(options.headed ? ["--headed"] : []),
		],
		{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
	);
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
