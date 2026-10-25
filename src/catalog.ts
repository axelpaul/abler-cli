import raw from "./operations.json";
import { parse, visit, Kind } from "graphql";
export type Operation = {
	name: string;
	kind: string;
	endpoint: string;
	variables: {
		name: string;
		type: string;
		required: boolean;
		default?: string;
	}[];
	document: string;
	source: string;
};
export const operations = raw as Operation[];
const loginOps = new Set([
	"login",
	"verifyOTP",
	"startFederatedClubOrOtp",
	"startFederatedSocialLogin",
	"exchangeFederatedSession",
]);
export function operation(name: string) {
	const exact = operations.find((x) => x.name === name);
	if (exact) return exact;
	const matches = operations.filter(
		(x) => x.name.toLowerCase() === name.toLowerCase(),
	);
	if (matches.length === 1) return matches[0]!;
	throw Error(
		matches.length
			? "Ambiguous operation name; use exact case."
			: `Unknown operation: ${name}. Run abler operations list.`,
	);
}
export function validateVariables(
	op: Operation,
	variables: Record<string, unknown>,
) {
	if (!variables || Array.isArray(variables) || typeof variables !== "object")
		throw Error("Variables must be a JSON object.");
	const known = new Set(op.variables.map((x) => x.name));
	for (const name of Object.keys(variables))
		if (!known.has(name)) throw Error(`Unknown variable: ${name}`);
	for (const v of op.variables) {
		const value = variables[v.name];
		if (v.required && (value === undefined || value === null))
			throw Error(`Required variable: ${v.name} (${v.type})`);
		if (value !== undefined && value !== null && !v.type.includes("[")) {
			const t = v.type.replace(/!/g, "");
			if (
				t === "Int" &&
				(!Number.isInteger(value) ||
					Number(value) > 2147483647 ||
					Number(value) < -2147483648)
			)
				throw Error(`${v.name} must be a GraphQL Int`);
			if (t === "Boolean" && typeof value !== "boolean")
				throw Error(`${v.name} must be boolean`);
			if ((t === "String" || t === "ID") && typeof value !== "string")
				throw Error(`${v.name} must be a string`);
		}
	}
}
export function documentFor(op: Operation) {
	const parsed = parse(op.document);
	const names = new Set(
		parsed.definitions
			.filter((x) => x.kind === Kind.FRAGMENT_DEFINITION)
			.map((x) => x.name.value),
	);
	visit(parsed, {
		FragmentSpread(n) {
			if (!names.has(n.name.value))
				throw Error(
					`Operation ${op.name} has an unresolved fragment ${n.name.value}; unavailable until recovered.`,
				);
		},
	});
	return op.document;
}
export function prepare(
	name: string,
	variables: Record<string, unknown>,
	write = false,
) {
	const op = operation(name);
	if (op.kind === "subscription")
		throw Error("Subscriptions are not supported by the HTTP transport.");
	if (loginOps.has(op.name.split("__")[0]!))
		throw Error(
			"Use browser-assisted login start/verify; this operation needs a fresh reCAPTCHA assessment.",
		);
	if (op.kind !== "query" && !write)
		throw Error(
			"Mutation blocked: explicitly confirm with --yes (MCP also requires ABLER_MCP_ENABLE_WRITES=1 or --allow-writes, then confirm=true).",
		);
	validateVariables(op, variables);
	return { op, document: documentFor(op) };
}
export function summarize(op: Operation) {
	let complete = true;
	try {
		documentFor(op);
	} catch {
		complete = false;
	}
	return {
		name: op.name,
		kind: op.kind,
		endpoint: op.endpoint,
		variables: op.variables,
		transport:
			op.kind === "subscription"
				? "websocket"
				: op.document.includes("@rest")
					? "rest"
					: "graphql",
		available: complete && !loginOps.has(op.name.split("__")[0]!),
		verification: "recovered-not-live-verified",
	};
}
