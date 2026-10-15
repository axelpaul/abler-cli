import { chromium, type Browser } from "playwright-core";
import { spawn } from "node:child_process";
import {
	existsSync,
	readFileSync,
	mkdirSync,
	chmodSync,
	writeFileSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { authDir, origin, importSession, logoutLocal } from "./session.ts";
export const defaultCDP = "http://127.0.0.1:9334";
function endpoint(value: string) {
	const u = new URL(value);
	if (
		!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
		u.protocol !== "http:"
	)
		throw Error("CDP must be a loopback HTTP URL.");
	return value;
}
async function connect(cdp: string, start = false, headed = false) {
	endpoint(cdp);
	try {
		return await chromium.connectOverCDP(cdp, { timeout: 1500 });
	} catch {
		if (!start)
			throw Error("Login browser is not running. Run abler login start first.");
	}
	let configuredChrome: string | undefined;
	try { configuredChrome = JSON.parse(readFileSync(join(authDir(), "browser.json"), "utf8")).executablePath; } catch {}
	const executable =
		process.env.ABLER_CHROME || configuredChrome ||
		[
			"/usr/bin/chromium",
			"/usr/bin/google-chrome",
		].find(existsSync);
	if (!executable)
		throw Error("Set ABLER_CHROME to an installed Chrome/Chromium executable.");
	const dir = join(authDir(), "browser-profile");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	const args = [
		...(headed ? [] : ["--headless"]),
		"--no-sandbox",
		`--remote-debugging-port=${new URL(cdp).port}`,
		`--user-data-dir=${dir}`,
		origin + "/sign-on/login",
	];
	const child = spawn(executable, args, { detached: true, stdio: "ignore" });
	let spawnError: Error | undefined;
	child.on("error", (e) => {
		spawnError = e;
	});
	child.unref();
	for (let i = 0; i < 40; i++) {
		if (spawnError) throw spawnError;
		await new Promise((resolve) => setTimeout(resolve, 150));
		try {
			return await chromium.connectOverCDP(cdp, { timeout: 1000 });
		} catch {}
	}
	throw Error(
		"Could not connect to the login browser. Check ABLER_CHROME and display settings.",
	);
}
async function pageFor(browser: Browser) {
	const c = browser.contexts()[0];
	if (!c) throw Error("Browser context unavailable.");
	return (
		c.pages().find((p) => p.url().startsWith(origin + "/sign-on")) ??
		(await c.newPage())
	);
}
export async function startLogin(
	phone: string,
	cdp = defaultCDP,
	headed = false,
) {
	if (
		!/^(?:\+354)?[678]\d{6}$/.test(phone.replace(/[ -]/g, "")) &&
		!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(phone)
	)
		throw Error("Supply an Icelandic mobile number or email.");
	const b = await connect(cdp, true, headed);
	try {
		const p = await pageFor(b);
		await p.goto(origin + "/sign-on/login", { waitUntil: "domcontentloaded" });
		await p
			.getByRole("textbox", { name: /Phone or email|Sími|Netfang/i })
			.fill(phone.replace(/^\+354/, ""));
		await p
			.getByRole("button", { name: /^Log in$|^Innskráning$|^Innskrá$/i })
			.click();
		await p
			.waitForFunction(
				() =>
					document.querySelectorAll("input[type=number]").length === 6,
				{},
				{ timeout: 20000 },
			)
			.catch(() => {});
		const count = await p.locator("input[type=number]").count();
		if (count < 4)
			throw Error(
				"Login did not advance to code verification. Complete any challenge in a headed browser; no automatic retry was made.",
			);
		return {
			codeRequested: true,
			codeLength: count,
			next: "abler login verify --stdin",
			cdp,
		};
	} finally {
		await b.close();
	}
}
export async function verifyLogin(code: string, cdp = defaultCDP) {
	if (!/^\d{6}$/.test(code)) throw Error("Expected a six-digit code.");
	const b = await connect(cdp);
	try {
		const p = await pageFor(b);
		const inputs = p.locator("input[type=number]");
		if ((await inputs.count()) !== 6)
			throw Error("No pending six-digit verification form.");
		for (let i = 0; i < 6; i++) await inputs.nth(i).fill(code[i]!);
		const button = p.getByRole("button", { name: /^Verify$|^Staðfesta$/i });
		if ((await button.isVisible()) && (await button.isEnabled()))
			await button.click();
		await p
			.waitForURL(
				(u) => u.origin === origin && !u.pathname.startsWith("/sign-on"),
				{ timeout: 20000 },
			)
			.catch(() => {});
		if (new URL(p.url()).pathname.startsWith("/sign-on"))
			throw Error(
				"Verification did not complete. Check the code or complete the browser challenge; no retry was made.",
			);
		const state = await p.context().storageState();
		const file = join(authDir(), "browser-state.json");
		mkdirSync(authDir(), { recursive: true, mode: 0o700 });
		writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
		chmodSync(file, 0o600);
		importSession(file);
		unlinkSync(file);
		return { authenticated: true, method: "browser-assisted" };
	} finally {
		await b.close();
	}
}
export async function closeLoginBrowser(cdp = defaultCDP) {
	const b = await connect(cdp);
	try {
		const session = await b.newBrowserCDPSession();
		await session.send("Browser.close");
	} finally {
		await b.close().catch(() => {});
	}
	return { closed: true };
}
