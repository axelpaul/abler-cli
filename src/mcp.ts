import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Service } from "./service.ts";
import { safeMessage } from "./client.ts";
import { version } from "./version.ts";
/** Writes are opt-in: `--allow-writes` or ABLER_MCP_ENABLE_WRITES=1. */
export function writesEnabled(flag = false, env = process.env) {
	return flag || ["1", "true", "yes"].includes(
		(env.ABLER_MCP_ENABLE_WRITES ?? "").toLowerCase(),
	);
}
export function createServer(allowWrites = false, service = new Service()) {
	const server = new McpServer({ name: "abler", version });
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
		wrap((a) => service.event(a.eventId)),
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
		wrap((a) => service.messages(a)),
	);
	server.registerTool(
		"abler_attendance",
		{
			description:
				"Read the attendance list (players and their responses) for an event. Same as `abler attendance <event-id>`. Use pageInfo cursor as `after` for the next page.",
			inputSchema: {
				eventId: z.string().min(1),
				first: z.number().int().min(1).max(100).optional(),
				after: z.string().optional(),
			},
			annotations: read,
		},
		wrap((a) => service.attendance(a.eventId, { first: a.first, after: a.after })),
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
		wrap((a) => service.operationsPage(a.search, a.kind, a.offset, a.limit)),
	);
	server.registerTool(
		"abler_operation",
		{
			description:
				"Show one recovered operation: variables, transport, availability and the full GraphQL document. Same as `abler operations show <name>`.",
			inputSchema: { name: z.string().min(1) },
			annotations: read,
		},
		wrap((a) => service.operationDetail(a.name)),
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
					"Execute a recovered mutation (e.g. SetPlayerAttendance, MessageReply) ONLY after user approval of its exact action and arguments. No automatic retry. Returns a dry-run plan unless confirm=true. Only registered when ABLER_MCP_ENABLE_WRITES=1 or --allow-writes.",
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
	return server;
}
export async function startMcp(allowWrites = false) {
	await createServer(allowWrites).connect(new StdioServerTransport());
}
