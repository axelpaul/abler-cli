import { test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
async function connect(writes = false) {
	const c = new Client({ name: "abler-test", version: "1.0.0" });
	const t = new StdioClientTransport({
		command: process.execPath,
		args: [
			resolve("src/index.ts"),
			"mcp",
			...(writes ? ["--allow-writes"] : []),
		],
		stderr: "pipe",
	});
	await c.connect(t);
	return c;
}
test("MCP handshake, tool discovery, catalog paging and read-only enforcement", async () => {
	const c = await connect();
	try {
		const tools = await c.listTools();
		expect(tools.tools.some((t) => t.name === "abler_mutate")).toBe(false);
		expect(tools.tools.some((t) => t.name === "abler_events")).toBe(true);
		const result = await c.callTool({
			name: "abler_operations",
			arguments: { search: "calendar", limit: 5 },
		});
		expect(result.isError).not.toBe(true);
		const write = await c.callTool({
			name: "abler_query",
			arguments: { operation: "EventDelete", variables: {} },
		});
		expect(write.isError).toBe(true);
	} finally {
		await c.close();
	}
}, 15000);
test("MCP opt-in writes expose dry-run, not automatic execution", async () => {
	const c = await connect(true);
	try {
		const tools = await c.listTools();
		expect(tools.tools.some((t) => t.name === "abler_mutate")).toBe(true);
		const result = await c.callTool({
			name: "abler_mutate",
			arguments: {
				operation: "EventDelete",
				variables: { eventId: "fixture", action: "DELETE" },
			},
		});
		expect(result.isError).not.toBe(true);
		expect(
			JSON.parse((result.content as { text: string }[])[0]!.text).dryRun,
		).toBe(true);
	} finally {
		await c.close();
	}
}, 15000);
