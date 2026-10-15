import { test, expect } from "bun:test";
import { parse, Kind } from "graphql";
import {
	operations,
	prepare,
	validateVariables,
	operation,
	summarize,
} from "./catalog.ts";
test("all recovered documents parse and catalog marks subscriptions as websocket operations", () => {
	expect(operations.length).toBeGreaterThan(250);
	for (const op of operations) {
		const doc = parse(op.document);
		expect(
			doc.definitions.filter((x) => x.kind === Kind.OPERATION_DEFINITION),
		).toHaveLength(1);
		if (op.kind === "subscription")
			expect(summarize(op).transport).toBe("websocket");
	}
});
test("mutations rejected before any network access unless explicitly confirmed", () => {
	const op = operations.find(
		(x) =>
			x.kind === "mutation" &&
			!x.document.includes("@rest") &&
			!["login", "verifyOTP"].includes(x.name),
	)!;
	expect(() => prepare(op.name, {}, false)).toThrow("Mutation blocked");
});
test("required and unknown variables and wrong scalar types are rejected", () => {
	const op = operation("event");
	expect(() => validateVariables(op, {})).toThrow("Required variable");
	expect(() => validateVariables(op, { eventId: "123", extra: true })).toThrow(
		"Unknown variable",
	);
	expect(() => validateVariables(op, { eventId: 123 })).toThrow(
		"must be a string",
	);
	expect(() =>
		validateVariables(operation("calendar"), { month: 1.2 }),
	).toThrow("GraphQL Int");
});
test("browser-only auth cannot accidentally use generic executor", () => {
	expect(() => prepare("login", {}, true)).toThrow("browser-assisted");
});
test("unknown and case-ambiguous operation names fail closed", () => {
	expect(() => operation("thisDoesNotExist")).toThrow("Unknown operation");
	expect(() => operation("AGEGROUP")).toThrow("Ambiguous");
});
