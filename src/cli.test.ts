import { test, expect } from "bun:test";
import { resolve } from "node:path";
async function cli(args: string[]) {
	const c = Bun.spawn([process.execPath, resolve("src/index.ts"), ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			ABLER_CONFIG_DIR: "/tmp/abler-deliberately-absent-test-profile",
		},
	});
	const [out, err, exit] = await Promise.all([
		new Response(c.stdout).text(),
		new Response(c.stderr).text(),
		c.exited,
	]);
	return { out, err, exit };
}
test("CLI rejects write execution before auth/network and permits concrete dry-run", async () => {
	const args = [
		"run",
		"SetPlayerAttendance",
		"--vars",
		'{"id":"fixture","status":"G"}',
	];
	const denied = await cli(args);
	expect(denied.exit).toBe(1);
	expect(denied.err).toContain("Mutation blocked");
	const dry = await cli([...args, "--dry-run"]);
	expect(dry.exit).toBe(0);
	expect(JSON.parse(dry.out).dryRun).toBe(true);
});
test("CLI rejects unknown options and malformed variables", async () => {
	expect((await cli(["me", "--made-up"])).exit).toBe(1);
	expect((await cli(["run", "calendar", "--vars", "[]"])).err).toContain(
		"JSON object",
	);
});

test("--version prints package.json version and --help lists serve", async () => {
	const pkg = await Bun.file(resolve("package.json")).json();
	const v = await cli(["--version"]);
	expect(v.exit).toBe(0);
	expect(v.out.trim()).toBe(pkg.version);
	const h = await cli(["--help"]);
	expect(h.out).toContain("serve");
	expect(h.out).toContain(pkg.version);
});
