import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CookieJar } from "tough-cookie";
import { Client } from "./client.ts";
import { save, load, sessionPath, importSession, origin } from "./session.ts";
import { writeFileSync } from "node:fs";
let dir: string;
let old: string | undefined;
beforeEach(() => {
	old = process.env.ABLER_CONFIG_DIR;
	dir = mkdtempSync(join(tmpdir(), "abler-test-"));
	process.env.ABLER_CONFIG_DIR = dir;
	const jar = new CookieJar();
	jar.setCookieSync("refresh=old; Secure; HttpOnly; Path=/", origin);
	save({ version: 1, jar: jar.serializeSync()!, expiresAt: 0 });
});
afterEach(() => {
	if (old === undefined) delete process.env.ABLER_CONFIG_DIR;
	else process.env.ABLER_CONFIG_DIR = old;
	rmSync(dir, { recursive: true, force: true });
});
const jwt = () =>
	`eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
test("refresh persists rotated HttpOnly cookies and bearer, and private permissions", async () => {
	const calls: any[] = [];
	const client = new Client((async (url: any, options: any) => {
		calls.push({ url, options });
		if (String(url).endsWith("/oauth/token"))
			return new Response(JSON.stringify({ access_token: jwt() }), {
				status: 201,
				headers: { "Set-Cookie": "refresh=rotated; Secure; HttpOnly; Path=/" },
			});
		expect(options.headers.Authorization).toStartWith("Bearer ");
		expect(options.headers.Cookie).toContain("refresh=rotated");
		return Response.json({ data: { me: { userId: "fixture" } } });
	}) as unknown as typeof fetch);
	expect(await client.doctor()).toMatchObject({
		authenticated: true,
		api: true,
	});
	expect(calls).toHaveLength(2);
	expect(readFileSync(sessionPath(), "utf8")).toContain("rotated");
	expect(statSync(sessionPath()).mode & 0o777).toBe(0o600);
});
test("GraphQL mutation failures are never retried and cookie rotation still persists", async () => {
	let calls = 0;
	save({ ...load(), accessToken: jwt(), expiresAt: Date.now() + 3600000 });
	const client = new Client((async () => {
		calls++;
		return Response.json(
			{ errors: [{ message: "Not allowed" }] },
			{ headers: { "Set-Cookie": "refresh=rotated; Secure; Path=/" } },
		);
	}) as unknown as typeof fetch);
	await expect(client.graphql("mutation DoNotRun { fixture }")).rejects.toThrow(
		"Not allowed",
	);
	expect(calls).toBe(1);
	expect(readFileSync(sessionPath(), "utf8")).toContain("rotated");
});
test("401 refresh fails with explicit auth error and no repeated login", async () => {
	let calls = 0;
	const client = new Client((async () => {
		calls++;
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}) as unknown as typeof fetch);
	await expect(client.doctor()).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
	expect(calls).toBe(1);
});
test("imports only Abler cookies and retains session privacy", () => {
	const input = join(dir, "import.json");
	writeFileSync(
		input,
		JSON.stringify({
			cookies: [
				{
					name: "session",
					value: "own",
					domain: ".abler.io",
					path: "/",
					secure: true,
					expires: -1,
				},
				{ name: "other", value: "foreign", domain: ".example.com", path: "/" },
			],
		}),
	);
	importSession(input);
	const jar = CookieJar.deserializeSync(load().jar);
	expect(jar.getCookieStringSync(origin)).toBe("session=own");
	expect(JSON.stringify(load())).not.toContain("foreign");
});
