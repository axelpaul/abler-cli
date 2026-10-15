import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Service } from "./service.ts";
import { safeMessage } from "./client.ts";
export async function startMcp(allowWrites = false) {
	const server = new McpServer({ name: "abler", version: "0.1.0" });
	const service = new Service();
	const result = (data: unknown) => ({
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	});
	const wrap =
		(fn: (a: any) => Promise<unknown> | unknown) => async (a: any) => {
			try {
				return result(await fn(a));
			} catch (e) {
				return {
					...result({
						error: safeMessage(
							e instanceof Error ? e.message : "Abler request failed",
						),
					}),
					isError: true,
				};
			}
		};
	const read = {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: true,
	};
	server.registerTool(
		"abler_doctor",
		{
			description:
				"Check saved session refresh and minimal account read. Does not expose credentials.",
			inputSchema: {},
			annotations: read,
		},
		wrap(() => service.client.doctor()),
	);
	server.registerTool(
		"abler_me",
		{
			description: "Read authenticated account identity.",
			inputSchema: {},
			annotations: read,
		},
		wrap(() => service.me()),
	);
	server.registerTool(
		"abler_family",
		{
			description: "Read account children and family links.",
			inputSchema: {},
			annotations: read,
		},
		wrap(() => service.family()),
	);
	server.registerTool(
		"abler_groups",
		{
			description: "Read own memberships, groups, and roles.",
			inputSchema: {},
			annotations: read,
		},
		wrap(() => service.groups()),
	);
	server.registerTool(
		"abler_events",
		{
			description:
				"Read calendar. Defaults to current month. Returns pageInfo; use cursor for subsequent pages.",
			inputSchema: {
				month: z.number().int().min(1).max(12).optional(),
				year: z.number().int().optional(),
				week: z.number().int().min(1).max(53).optional(),
				cursor: z.string().optional(),
				filter: z.record(z.string(), z.unknown()).optional(),
			},
			annotations: read,
		},
		wrap((a) => service.events(a)),
	);
	server.registerTool(
		"abler_event",
		{
			description: "Read event details by ID.",
			inputSchema: { eventId: z.string().min(1) },
			annotations: read,
		},
		wrap((a) => service.execute("event", a)),
	);
	server.registerTool(
		"abler_messages",
		{
			description: "Read conversations/messages; this does not send messages.",
			inputSchema: {
				id: z.string().optional(),
				first: z.number().int().min(1).max(100).optional(),
				cursor: z.string().optional(),
			},
			annotations: read,
		},
		wrap((a) => service.execute("message", { first: 20, ...a })),
	);
	server.registerTool(
		"abler_operations",
		{
			description:
				"Browse recovered operations and variable contracts. Recovered does not imply live verified or role-authorized.",
			inputSchema: {
				search: z.string().optional(),
				kind: z.enum(["query", "mutation", "subscription"]).optional(),
				offset: z.number().int().min(0).default(0),
				limit: z.number().int().min(1).max(100).default(30),
			},
			annotations: read,
		},
		wrap((a) => {
			const all = service.list(a.search, a.kind);
			return {
				total: all.length,
				operations: all.slice(a.offset, a.offset + a.limit),
				nextOffset: a.offset + a.limit < all.length ? a.offset + a.limit : null,
			};
		}),
	);
	server.registerTool(
		"abler_watch",
		{
			description:
				"Observe a recovered real-time subscription for a bounded interval; does not send messages or change attendance.",
			inputSchema: {
				operation: z.string(),
				variables: z.record(z.string(), z.unknown()).default({}),
				seconds: z.number().int().min(1).max(60).default(10),
				maxEvents: z.number().int().min(1).max(100).default(10),
			},
			annotations: read,
		},
		wrap(async (a) => {
			const { watch } = await import("./watch.ts");
			return watch(a.operation, a.variables, a.seconds, a.maxEvents);
		}),
	);
	server.registerTool(
		"abler_query",
		{
			description:
				"Execute a named recovered read operation. Supply the exact variables shown by abler_operations. Mutations are rejected.",
			inputSchema: {
				operation: z.string(),
				variables: z.record(z.string(), z.unknown()).default({}),
				endpoint: z.enum(["main", "auth", "reports", "partner"]).optional(),
			},
			annotations: read,
		},
		wrap((a) => service.execute(a.operation, a.variables, false, a.endpoint)),
	);
	if (allowWrites)
		server.registerTool(
			"abler_mutate",
			{
				description:
					"Execute a recovered mutation ONLY after user approval of its exact action and arguments. No automatic retry. Returns dry-run plan unless confirm=true.",
				inputSchema: {
					operation: z.string(),
					variables: z.record(z.string(), z.unknown()).default({}),
					confirm: z.boolean().default(false),
					endpoint: z.enum(["main", "auth", "reports", "partner"]).optional(),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
					idempotentHint: false,
					openWorldHint: true,
				},
			},
			wrap(async (a) => {
				const { prepare } = await import("./catalog.ts");
				const { op, document } = prepare(a.operation, a.variables, true);
				if (op.kind !== "mutation") throw Error("Use abler_query for reads.");
				if (!a.confirm)
					return {
						dryRun: true,
						operation: op.name,
						endpoint: op.endpoint,
						variables: a.variables,
						document,
					};
				return service.execute(op.name, a.variables, true, a.endpoint);
			}),
		);
	await server.connect(new StdioServerTransport());
}
