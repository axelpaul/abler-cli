import {
	mkdirSync,
	readFileSync,
	writeFileSync,
	renameSync,
	chmodSync,
	openSync,
	closeSync,
	unlinkSync,
	statSync,
	existsSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CookieJar } from "tough-cookie";
export type BrowserCookie = {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure?: boolean;
	httpOnly?: boolean;
	expires?: number;
	sameSite?: string;
};
export type Session = {
	version: 1;
	jar: NonNullable<ReturnType<CookieJar["serializeSync"]>>;
	accessToken?: string;
	expiresAt?: number;
};
export const origin = "https://www.abler.io";
export function authDir() {
	return process.env.ABLER_CONFIG_DIR
		? resolve(process.env.ABLER_CONFIG_DIR)
		: join(homedir(), ".config", "abler");
}
export function sessionPath() {
	return join(authDir(), "session.json");
}
export function save(session: Session) {
	mkdirSync(authDir(), { recursive: true, mode: 0o700 });
	chmodSync(authDir(), 0o700);
	const tmp = sessionPath() + `.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(session), { mode: 0o600 });
	chmodSync(tmp, 0o600);
	renameSync(tmp, sessionPath());
}
export function load(): Session {
	try {
		const s = JSON.parse(readFileSync(sessionPath(), "utf8"));
		if (s.version !== 1 || !s.jar) throw Error();
		return s;
	} catch {
		throw Error(
			"Not authenticated. Run abler login start or abler login import --file <private-session-file>.",
		);
	}
}
export function tokenExpiry(token: string): number {
	try {
		return (
			JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString())
				.exp * 1000
		);
	} catch {
		return 0;
	}
}
export function importSession(file: string) {
	const input = JSON.parse(readFileSync(file, "utf8"));
	if (input.version === 1 && input.jar) {
		CookieJar.deserializeSync(input.jar);
		save(input);
		return;
	}
	if (!Array.isArray(input.cookies))
		throw Error("Expected Playwright storage state or session cookies.");
	const jar = new CookieJar();
	for (const c of input.cookies as BrowserCookie[]) {
		const host = c.domain.replace(/^\./, "");
		if (host !== "abler.io" && !host.endsWith(".abler.io")) continue;
		jar.setCookieSync(
			`${c.name}=${c.value}; Path=${c.path || "/"}${c.domain.startsWith(".") ? `; Domain=${c.domain}` : ""}${c.secure ? "; Secure" : ""}${c.httpOnly ? "; HttpOnly" : ""}${c.expires && c.expires > 0 ? `; Expires=${new Date(c.expires * 1000).toUTCString()}` : ""}`,
			`https://${host}${c.path || "/"}`,
		);
	}
	const accessToken = input.token_response?.access_token;
	save({
		version: 1,
		jar: jar.serializeSync()!,
		accessToken,
		expiresAt: accessToken ? tokenExpiry(accessToken) : 0,
	});
}
export async function withLock<T>(fn: () => Promise<T>): Promise<T> {
	mkdirSync(authDir(), { recursive: true, mode: 0o700 });
	const path = join(authDir(), "session.lock");
	const start = Date.now();
	let fd: number;
	while (true) {
		try {
			fd = openSync(path, "wx", 0o600);
			writeFileSync(fd, String(process.pid));
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			try {
				const pid = Number(readFileSync(path, "utf8"));
				if (Number.isInteger(pid) && pid > 0) {
					try {
						process.kill(pid, 0);
					} catch (dead) {
						if ((dead as NodeJS.ErrnoException).code === "ESRCH") {
							unlinkSync(path);
							continue;
						}
					}
				} else if (Date.now() - statSync(path).mtimeMs > 60000) {
					unlinkSync(path);
					continue;
				}
			} catch {}
			if (Date.now() - start > 20000)
				throw Error(
					"Another Abler process is using the session; retry after it completes.",
				);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	try {
		return await fn();
	} finally {
		closeSync(fd!);
		unlinkSync(path);
	}
}
export function logoutLocal() {
	for (const f of ["session.json", "browser-state.json"]) {
		const p = join(authDir(), f);
		if (existsSync(p)) unlinkSync(p);
	}
}
