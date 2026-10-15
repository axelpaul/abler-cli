import { CookieJar } from "tough-cookie";
import {
	load,
	save,
	withLock,
	origin,
	tokenExpiry,
	type Session,
} from "./session.ts";
export class ApiError extends Error {
	constructor(
		public code: string,
		message: string,
		public status?: number,
	) {
		super(message);
	}
}
export function safeMessage(message: string) {
	return message
		.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
		.replace(
			/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
			"[redacted token]",
		);
}
export class Client {
	constructor(private transport: typeof fetch = fetch) {}
	private async request(
		path: string,
		body: unknown,
		session: Session,
		jar: CookieJar,
		bearer = false,
		method = "POST",
	) {
		const cookie = jar.getCookieStringSync(origin + path);
		const headers: Record<string, string> = {
			Origin: origin,
			Referer: origin + "/coach",
			"Content-Type": "application/json",
			Cookie: cookie,
		};
		if (bearer && session.accessToken)
			headers.Authorization = `Bearer ${session.accessToken}`;
		let response: Response;
		try {
			response = await this.transport(origin + path, {
				method,
				headers,
				body: method === "GET" ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(30000),
				redirect: "error",
			});
		} catch {
			throw new ApiError(
				"NETWORK",
				"Abler request failed or timed out; no mutation was automatically retried.",
			);
		}
		for (const c of response.headers.getSetCookie())
			jar.setCookieSync(c, origin + path);
		let result: any;
		try {
			const text = await response.text();
			result = text ? JSON.parse(text) : null;
		} catch {
			throw new ApiError(
				"INVALID_RESPONSE",
				`Abler returned a non-JSON response (HTTP ${response.status}).`,
				response.status,
			);
		}
		if (!response.ok)
			throw new ApiError(
				response.status === 401 ? "AUTH_EXPIRED" : "HTTP",
				`Abler HTTP ${response.status}${Array.isArray(result?.errors) ? ": " + result.errors.map((x: any) => safeMessage(String(x.message))).join("; ") : ""}`,
				response.status,
			);
		return result;
	}
	private async refresh(session: Session, jar: CookieJar) {
		const data = await this.request("/oauth/token", {}, session, jar);
		if (!data.access_token)
			throw new ApiError(
				"AUTH_EXPIRED",
				"Session refresh failed. Complete browser-assisted login again.",
			);
		session.accessToken = data.access_token;
		session.expiresAt = tokenExpiry(data.access_token);
		session.jar = jar.serializeSync()!;
		save(session);
	}
	async graphql(
		document: string,
		variables: Record<string, unknown> = {},
		endpoint: "main" | "auth" | "reports" | "partner" = "main",
	) {
		return withLock(async () => {
			const session = load();
			const jar = CookieJar.deserializeSync(session.jar);
			if (!session.accessToken || (session.expiresAt ?? 0) < Date.now() + 60000)
				await this.refresh(session, jar);
			try {
				const result = await this.request(
					{
						main: "/graphql",
						auth: "/auth/graphql",
						reports: "/reports/api/graphql",
						partner: "/partner-api/graphql",
					}[endpoint],
					{ query: document, variables },
					session,
					jar,
					true,
				);
				if (result.errors?.length)
					throw new ApiError(
						"GRAPHQL",
						result.errors
							.map((x: any) => safeMessage(String(x.message)))
							.join("; "),
					);
				return result.data;
			} finally {
				session.jar = jar.serializeSync()!;
				save(session);
			}
		});
	}
	async rest(path: string, method: string, body: unknown) {
		if (!path.startsWith("/accounting/") && !path.startsWith("/workouts/"))
			throw Error("Unrecognized REST path");
		return withLock(async () => {
			const session = load(),
				jar = CookieJar.deserializeSync(session.jar);
			if (!session.accessToken || (session.expiresAt ?? 0) < Date.now() + 60000)
				await this.refresh(session, jar);
			try {
				return await this.request(path, body, session, jar, true, method);
			} finally {
				session.jar = jar.serializeSync()!;
				save(session);
			}
		});
	}
	async refreshOnly() {
		return withLock(async () => {
			const s = load();
			await this.refresh(s, CookieJar.deserializeSync(s.jar));
			return {
				authenticated: true,
				expiresAt: s.expiresAt ? new Date(s.expiresAt).toISOString() : null,
			};
		});
	}
	async doctor() {
		await this.refreshOnly();
		const data = await this.graphql("query AblerDoctor { me { userId } }");
		return { authenticated: !!data?.me, api: !!data?.me, origin };
	}
}
