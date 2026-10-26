#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { Service } from "./service.ts";
import { operation, prepare, summarize } from "./catalog.ts";
import { importSession, logoutLocal, authDir } from "./session.ts";
import { safeMessage } from "./client.ts";
const help = `Abler CLI 0.1.0 — browser-assisted login, standalone API, MCP\n\nUsage: abler <command> [options]\n\n  login start --phone <number-or-email> [--cdp <loopback-url>] [--headed]\n  login verify --stdin [--cdp <loopback-url>]\n  login import --file <private-storage-state-or-session>\n  login refresh | login close | logout\n  doctor | me | family | groups\n  events [--month N --year N | --week N] [--cursor CURSOR]\n  event <event-id>\n  messages [--first 20 --cursor CURSOR]\n  operations list [--search TEXT --kind query|mutation] [--limit N --offset N]\n  operations show <name>\n  run <operation> [--vars '{...}' | --vars-file FILE] [--dry-run | --yes]\n  schema [--search TEXT]        Alias for operations list\n  watch <subscription> [--seconds 10 --max-events 10] [--vars '{...}']\n  attendance <event-id> [--first 20 --cursor CURSOR]\n  attendance set --vars '{...}' [--dry-run | --yes]\n  serve [--allow-writes]          stdio MCP; read-only by default\n  version\n\nAll results are JSON; --json is accepted. Queries preserve API pagination.\nMutations need --yes; --dry-run validates without network access.\nBrowser login may require human challenge completion; never bypasses CAPTCHA.\nConfig: ABLER_CONFIG_DIR, ABLER_CHROME. No tokens printed.\n`;
export async function main(argv = process.argv.slice(2)) {
	const { values: v, positionals: p } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			json: { type: "boolean" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean" },
			yes: { type: "boolean" },
			"dry-run": { type: "boolean" },
			"allow-writes": { type: "boolean" },
			stdin: { type: "boolean" },
			headed: { type: "boolean" },
			file: { type: "string" },
			phone: { type: "string" },
			cdp: { type: "string" },
			vars: { type: "string" },
			"vars-file": { type: "string" },
			month: { type: "string" },
			week: { type: "string" },
			year: { type: "string" },
			cursor: { type: "string" },
			first: { type: "string" },
			search: { type: "string" },
			kind: { type: "string" },
			limit: { type: "string" },
			offset: { type: "string" },
			seconds: { type: "string" },
			"max-events": { type: "string" },
			endpoint: { type: "string" },
		},
	});
	const [parsedCommand, sub, id] = p;
	const cmd = v.version ? "version" : parsedCommand;
	let out: unknown;
	const svc = new Service();
	if (v.help || !cmd) {
		console.log(help);
		return;
	}
	const variables = () => {
		if (v.vars && v["vars-file"]) throw Error("Choose --vars or --vars-file.");
		const x = JSON.parse(
			v.vars ?? (v["vars-file"] ? readFileSync(v["vars-file"], "utf8") : "{}"),
		);
		if (!x || Array.isArray(x) || typeof x !== "object")
			throw Error("Variables must be a JSON object.");
		return x as Record<string, unknown>;
	};
	const ints = () => {
		const x: Record<string, unknown> = {};
		for (const key of ["month", "week", "year", "first"] as const)
			if (v[key] !== undefined) {
				const n = Number(v[key]);
				if (!Number.isInteger(n)) throw Error(`${key} must be an integer`);
				if (
					(key === "month" && (n < 1 || n > 12)) ||
					(key === "week" && (n < 1 || n > 53)) ||
					(key === "first" && (n < 1 || n > 100))
				)
					throw Error(`${key} outside allowed range`);
				x[key] = n;
			}
		if (v.cursor) x.cursor = v.cursor;
		return x;
	};
	switch (cmd) {
		case "version":
			out = { version: "0.1.0" };
			break;
		case "serve":
		case "mcp": {
			const { startMcp } = await import("./mcp.ts");
			await startMcp(v["allow-writes"] || process.env.ABLER_MCP_ENABLE_WRITES === "1");
			return;
		}
		case "doctor":
			out = await svc.client.doctor();
			break;
		case "me":
			out = await svc.me();
			break;
		case "family":
			out = await svc.family();
			break;
		case "groups":
			out = await svc.groups();
			break;
		case "events":
			out = await svc.events({ ...variables(), ...ints() });
			break;
		case "event":
			if (!sub) throw Error("Supply event ID");
			out = await svc.execute("event", { eventId: sub });
			break;
		case "watch": {
			if (!sub) throw Error("Supply subscription name");
			const { watch } = await import("./watch.ts");
			out = await watch(
				sub,
				variables(),
				Number(v.seconds ?? 10),
				Number(v["max-events"] ?? 10),
			);
			break;
		}
		case "attendance":
			if (sub === "set") {
				const vars = variables();
				const { op, document } = prepare(
					"SetPlayerAttendance",
					vars,
					!!v.yes || !!v["dry-run"],
				);
				out = v["dry-run"]
					? { dryRun: true, operation: op.name, variables: vars, document }
					: await svc.execute(op.name, vars, !!v.yes);
			} else {
				if (!sub) throw Error("Supply event ID");
				const vars = variables(),
					numbers = ints();
				delete numbers.cursor;
				out = await svc.execute("eventPlayer", {
					eventId: sub,
					first: 20,
					...vars,
					...numbers,
					...(v.cursor ? { after: v.cursor } : {}),
				});
			}
			break;
		case "messages":
			out = await svc.execute("message", {
				first: 20,
				...variables(),
				...ints(),
			});
			break;
		case "logout":
			logoutLocal();
			out = {
				loggedOut: true,
				scope: "local-session",
				note: "Run login close to stop the browser; browser profile may still retain login cookies.",
			};
			break;
		case "login":
			switch (sub) {
				case "import":
					if (!v.file) throw Error("Supply --file");
					importSession(v.file);
					out = await svc.client.doctor();
					break;
				case "refresh":
					out = await svc.client.refreshOnly();
					break;
				case "start": {
					if (!v.phone) throw Error("Supply --phone <number-or-email>");
					const { browserAction } = await import("./browser-bridge.ts");
					out = await browserAction("start", {
						phone: v.phone,
						cdp: v.cdp,
						headed: v.headed,
					});
					break;
				}
				case "verify": {
					if (!v.stdin)
						throw Error(
							"Supply the OTP through stdin: abler login verify --stdin",
						);
					const code = readFileSync(0, "utf8").trim();
					const { browserAction } = await import("./browser-bridge.ts");
					out = await browserAction("verify", { code, cdp: v.cdp });
					out = { ...(out as object), verification: await svc.client.doctor() };
					break;
				}
				case "close": {
					const { browserAction } = await import("./browser-bridge.ts");
					out = await browserAction("close", { cdp: v.cdp });
					break;
				}
				default:
					throw Error(
						"Expected login start, verify, import, refresh, or close",
					);
			}
			break;
		case "schema":
		case "operations":
			if (sub === "show") {
				if (!id) throw Error("Supply operation name");
				const op = operation(id);
				out = { ...summarize(op), document: op.document };
			} else {
				if (v.kind && !["query", "mutation", "subscription"].includes(v.kind))
					throw Error("Invalid operation kind");
				const all = svc.list(v.search, v.kind);
				const offset = Number(v.offset ?? 0),
					limit = Number(v.limit ?? 30);
				if (
					!Number.isInteger(offset) ||
					offset < 0 ||
					!Number.isInteger(limit) ||
					limit < 1 ||
					limit > 1000
				)
					throw Error("Invalid offset/limit");
				out = {
					total: all.length,
					operations: all.slice(offset, offset + limit),
					nextOffset: offset + limit < all.length ? offset + limit : null,
				};
			}
			break;
		case "run": {
			if (!sub) throw Error("Supply operation name");
			const vars = variables();
			if (
				v.endpoint &&
				!["main", "auth", "reports", "partner"].includes(v.endpoint)
			)
				throw Error("Invalid endpoint");
			const endpoint = v.endpoint as
				| "main"
				| "auth"
				| "reports"
				| "partner"
				| undefined;
			const { op, document } = prepare(sub, vars, !!v.yes || !!v["dry-run"]);
			out = v["dry-run"]
				? {
						dryRun: true,
						operation: op.name,
						endpoint: endpoint ?? op.endpoint,
						variables: vars,
						document,
					}
				: await svc.execute(sub, vars, !!v.yes, endpoint);
			break;
		}
		default:
			throw Error(`Unknown command: ${cmd}`);
	}
	console.log(JSON.stringify(out, null, 2));
}
if (import.meta.main)
	main().catch((e) => {
		console.error(
			JSON.stringify({
				error: safeMessage(
					e instanceof Error ? e.message : "Abler command failed",
				),
			}),
		);
		process.exitCode = 1;
	});
