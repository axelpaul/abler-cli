import { test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { writesEnabled } from "./mcp.ts";
import pkg from "../package.json" with { type: "json" };
async function connect(
	writes = false,
	command = "serve",
	env: Record<string, string> = {},
) {
	const c = new Client({ name: "abler-test", version: "1.0.0" });
	const t = new StdioClientTransport({
		command: process.execPath,
		args: [
			resolve("src/index.ts"),
			command,
			...(writes ? ["--allow-writes"] : []),
		],
		env: {
			...(process.env as Record<string, string>),
			ABLER_CONFIG_DIR: "/tmp/abler-deliberately-absent-test-profile",
			ABLER_MCP_ENABLE_WRITES: "",
			...env,
		},
		stderr: "pipe",
	});
	await c.connect(t);
	return c;
}
test("MCP handshake, tool discovery, catalog paging and read-only enforcement", async () => {
	const c = await connect();
	try {
		expect(c.getServerVersion()?.version).toBe(pkg.version);
		const tools = await c.listTools();
		expect(tools.tools.map((t) => t.name).sort()).toEqual([
			"abler_attendance",
			"abler_doctor",
			"abler_event",
			"abler_events",
			"abler_family",
			"abler_groups",
			"abler_me",
			"abler_messages",
			"abler_operation",
			"abler_operations",
			"abler_query",
			"abler_watch",
		]);
		const show = await c.callTool({
			name: "abler_operation",
			arguments: { name: "SetPlayerAttendance" },
		});
		expect(
			JSON.parse((show.content as { text: string }[])[0]!.text).document,
		).toContain("mutation");
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

test("mcp alias and ABLER_MCP_ENABLE_WRITES env var expose the write tool", async () => {
	const c = await connect(false, "mcp", { ABLER_MCP_ENABLE_WRITES: "1" });
	try {
		const tools = await c.listTools();
		expect(tools.tools.some((t) => t.name === "abler_mutate")).toBe(true);
	} finally {
		await c.close();
	}
}, 15000);

test("writesEnabled honours flag and env var only", () => {
	expect(writesEnabled(false, {})).toBe(false);
	expect(writesEnabled(false, { ABLER_MCP_ENABLE_WRITES: "0" })).toBe(false);
	expect(writesEnabled(false, { ABLER_MCP_ENABLE_WRITES: "1" })).toBe(true);
	expect(writesEnabled(true, {})).toBe(true);
});
