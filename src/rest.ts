import { parse, Kind, valueFromASTUntyped, type FieldNode } from "graphql";
export function restPlan(document: string, variables: Record<string, unknown>) {
	const doc = parse(document);
	const op = doc.definitions.find((x) => x.kind === Kind.OPERATION_DEFINITION);
	if (
		!op ||
		op.kind !== Kind.OPERATION_DEFINITION ||
		op.selectionSet.selections.length !== 1
	)
		throw Error("REST operation must have one root field.");
	const field = op.selectionSet.selections[0] as FieldNode;
	if (field.kind !== Kind.FIELD) throw Error("Invalid REST field");
	const directive = field.directives?.find((x) => x.name.value === "rest");
	if (!directive) throw Error("Missing REST directive.");
	const config = Object.fromEntries(
		(directive.arguments ?? []).map((x) => [
			x.name.value,
			valueFromASTUntyped(x.value, variables),
		]),
	);
	const args = Object.fromEntries(
		(field.arguments ?? []).map((x) => [
			x.name.value,
			valueFromASTUntyped(x.value, variables),
		]),
	);
	const base = (
		{ accounting: "/accounting/", workouts: "/workouts/" } as Record<
			string,
			string
		>
	)[String(config.endpoint)];
	if (!base) throw Error("Unrecognized REST endpoint.");
	const path = String(config.path).replace(
		/\{args\.([A-Za-z0-9_]+)\}/g,
		(_, name: string) => {
			const value = args[name];
			if (value === undefined || value === null) return "";
			if (typeof value === "object") {
				const q = new URLSearchParams();
				for (const [k, v] of Object.entries(value))
					if (v !== undefined && v !== null) {
						if (Array.isArray(v))
							for (const item of v) q.append(k, String(item));
						else q.set(k, String(v));
					}
				return q.toString();
			}
			return encodeURIComponent(String(value));
		},
	);
	if (path.includes("{") || path.startsWith("/") || path.includes(".."))
		throw Error("Unsupported REST path.");
	const method = String(config.method ?? "GET");
	if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
		throw Error("Unsupported REST method.");
	if (op.operation === "query" && method !== "GET")
		throw Error("Recovered query specifies a write method.");
	return {
		path: base + path,
		method,
		body: args.input,
		key: field.alias?.value ?? field.name.value,
	};
}
