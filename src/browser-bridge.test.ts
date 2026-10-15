import { test, expect } from "bun:test";
import { browserAction } from "./browser-bridge.ts";
import { resolve } from "node:path";
test("Node browser helper loads and rejects invalid OTP without connecting or resending", async () => {
	const old = process.env.ABLER_SOURCE_DIR;
	process.env.ABLER_SOURCE_DIR = resolve(".");
	try {
		await expect(browserAction("verify", { code: "invalid" })).rejects.toThrow(
			"Expected a six-digit code",
		);
	} finally {
		if (old === undefined) delete process.env.ABLER_SOURCE_DIR;
		else process.env.ABLER_SOURCE_DIR = old;
	}
}, 5000);
