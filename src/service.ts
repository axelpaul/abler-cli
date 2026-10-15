import { restPlan } from "./rest.ts";
import { Client } from "./client.ts";
import { prepare, operations, summarize } from "./catalog.ts";
export class Service {
	constructor(public client = new Client()) {}
	async execute(
		name: string,
		variables: Record<string, unknown> = {},
		write = false,
		endpoint?: "main" | "auth" | "reports" | "partner",
	) {
		const { op, document } = prepare(name, variables, write);
		if (document.includes("@rest")) {
			const plan = restPlan(document, variables);
			return {
				[plan.key]: await this.client.rest(plan.path, plan.method, plan.body),
			};
		}
		return this.client.graphql(
			document,
			variables,
			endpoint ?? (op.endpoint === "auth" ? "auth" : "main"),
		);
	}
	async me() {
		const data = await this.client.graphql(
			"query AblerMe { me { userId id displayName firstName lastName } }",
		);
		return data.me;
	}
	async family() {
		const data = await this.client.graphql(
			"query AblerFamily { me { children { id displayName } famelyMembers { famelyMember { id displayName } } } }",
		);
		return data.me;
	}
	async groups() {
		const data = await this.client.graphql(
			"query AblerGroups { me { userAgeGroups { id orgId name isActive groups { id name label } sport { id name } } ageGroupRoles { ageGroupId role memberVisibility } } }",
		);
		return data.me;
	}
	async events(variables: Record<string, unknown> = {}) {
		const now = new Date();
		return this.execute("calendar", {
			...(!("month" in variables) && !("week" in variables)
				? { month: now.getUTCMonth(), year: now.getUTCFullYear() }
				: {}),
			...variables,
			...(variables.month !== undefined ? {month: Number(variables.month)-1} : {}),
		});
	}
	list(filter = "", kind?: string) {
		return operations
			.filter(
				(x) =>
					(!kind || x.kind === kind) &&
					x.name.toLowerCase().includes(filter.toLowerCase()),
			)
			.map(summarize);
	}
}
