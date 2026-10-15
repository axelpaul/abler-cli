import { test, expect } from "bun:test";
import { captureSubscription } from "./watch.ts";
test("subscription uses observed legacy protocol and id_token authentication", async () => {
	let authenticated = false,
		started = false;
	const server = Bun.serve({
		port: 0,
		fetch(req, server) {
			if (server.upgrade(req)) return;
			return new Response("upgrade required", { status: 400 });
		},
		websocket: {
			message(ws, raw) {
				const msg = JSON.parse(String(raw));
				if (msg.type === "connection_init") {
					authenticated = msg.payload.id_token === "Bearer fixture-token";
					ws.send(JSON.stringify({ type: "connection_ack" }));
				} else if (msg.type === "start") {
					started = true;
					ws.send(
						JSON.stringify({
							id: msg.id,
							type: "data",
							payload: { data: { fixture: "event" } },
						}),
					);
				}
			},
		},
	});
	try {
		const result = await captureSubscription(
			`ws://127.0.0.1:${server.port}`,
			"fixture-token",
			"",
			"subscription Fixture { fixture }",
			{},
			3,
			1,
		);
		expect(authenticated).toBe(true);
		expect(started).toBe(true);
		expect(result).toMatchObject({
			acknowledged: true,
			events: [{ fixture: "event" }],
			reason: "max-events",
		});
	} finally {
		server.stop(true);
	}
}, 5000);
test("watch rejects unbounded observation", async () => {
	await expect(
		captureSubscription("ws://127.0.0.1:1", "", "", "", {}, 1000, 1),
	).rejects.toThrow("Watch bounds");
});
