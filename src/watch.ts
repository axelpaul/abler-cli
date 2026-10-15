import { CookieJar } from "tough-cookie";
import { Client, safeMessage } from "./client.ts";
import { load, origin } from "./session.ts";
import { operation, documentFor, validateVariables } from "./catalog.ts";
export async function captureSubscription(
	url: string,
	token: string,
	cookie: string,
	document: string,
	variables: Record<string, unknown>,
	seconds = 10,
	maxEvents = 10,
) {
	if (
		!Number.isInteger(seconds) ||
		seconds < 1 ||
		seconds > 60 ||
		!Number.isInteger(maxEvents) ||
		maxEvents < 1 ||
		maxEvents > 100
	)
		throw Error("Watch bounds: seconds 1–60, max-events 1–100.");
	return new Promise<{
		acknowledged: boolean;
		events: unknown[];
		reason: string;
	}>((resolve, reject) => {
		const events: unknown[] = [];
		let ack = false,
			settled = false;
		const WS = WebSocket as unknown as {
			new (
				url: string,
				options: { protocols: string[]; headers: Record<string, string> },
			): WebSocket;
		};
		const ws = new WS(url, {
			protocols: ["graphql-ws"],
			headers: { Cookie: cookie },
		});
		const finish = (reason: string, error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ id: "1", type: "stop" }));
				ws.close();
			} else ws.close();
			if (error) reject(error);
			else resolve({ acknowledged: ack, events, reason });
		};
		const timer = setTimeout(
			() =>
				finish(
					ack ? "timeout" : "connection-timeout",
					ack
						? undefined
						: Error("Subscription connection was not acknowledged."),
				),
			seconds * 1000,
		);
		ws.onopen = () =>
			ws.send(
				JSON.stringify({
					type: "connection_init",
					payload: { id_token: `Bearer ${token}` },
				}),
			);
		ws.onmessage = (e) => {
			try {
				const message = JSON.parse(String(e.data));
				if (message.type === "connection_ack") {
					ack = true;
					ws.send(
						JSON.stringify({
							id: "1",
							type: "start",
							payload: { query: document, variables },
						}),
					);
				} else if (message.type === "data") {
					if (message.payload?.errors)
						finish(
							"error",
							Error(safeMessage(JSON.stringify(message.payload.errors))),
						);
					else {
						events.push(message.payload?.data);
						if (events.length >= maxEvents) finish("max-events");
					}
				} else if (
					message.type === "error" ||
					message.type === "connection_error"
				)
					finish("error", Error("Subscription was rejected by Abler."));
				else if (message.type === "complete") finish("complete");
			} catch {
				finish("error", Error("Invalid subscription response."));
			}
		};
		ws.onerror = () => finish("error", Error("Subscription transport failed."));
		ws.onclose = () =>
			finish(
				"closed",
				ack
					? undefined
					: Error("Subscription connection closed before acknowledgment."),
			);
	});
}
export async function watch(
	name: string,
	variables: Record<string, unknown> = {},
	seconds = 10,
	maxEvents = 10,
) {
	const op = operation(name);
	if (op.kind !== "subscription")
		throw Error("Watch requires a recovered subscription operation.");
	validateVariables(op, variables);
	const document = documentFor(op);
	await new Client().refreshOnly();
	const s = load();
	return captureSubscription(
		"wss://www.abler.io/subscriptions",
		s.accessToken!,
		CookieJar.deserializeSync(s.jar).getCookieStringSync(origin),
		document,
		variables,
		seconds,
		maxEvents,
	);
}
