import { test, expect } from "bun:test";
import { restPlan } from "./rest.ts";
import { operation, prepare } from "./catalog.ts";
test("REST routes are fixed first-party endpoints and input variables are encoded", () => {
	const op = operation("accountingCategories");
	expect(restPlan(op.document, { clubId: 42 })).toMatchObject({
		path: "/accounting/categories/42",
		method: "GET",
	});
	const write = operation("deleteCategory");
	expect(
		restPlan(write.document, { clubId: 42, category: "hello/world?query" })
			.path,
	).toBe("/accounting/categories/42/hello%2Fworld%3Fquery");
});
test("REST writes have same explicit confirmation gate as GraphQL", () => {
	expect(() =>
		prepare("deleteCategory", { clubId: 42, category: "fixture" }),
	).toThrow("Mutation blocked");
});
test("REST input objects become request bodies without string substitution", () => {
	const op = operation("saveClubAccountContext");
	const body = { dimension: "fixture" };
	expect(restPlan(op.document, { clubId: 42, context: body })).toMatchObject({
		path: "/accounting/context/42",
		method: "PUT",
		body,
	});
});
