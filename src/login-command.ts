import { readFileSync } from "node:fs";
import { startLogin, verifyLogin, closeLoginBrowser } from "./login.ts";
import { safeMessage } from "./client.ts";
if (import.meta.main) {
	try {
		const options = JSON.parse(readFileSync(0, "utf8"));
		const cdp = process.argv[3];
		let out: unknown;
		switch (process.argv[2]) {
			case "start":
				out = await startLogin(options.phone, cdp, options.headed);
				break;
			case "verify":
				out = await verifyLogin(options.code, cdp);
				break;
			case "close":
				out = await closeLoginBrowser(cdp);
				break;
			default:
				throw Error("Invalid browser action");
		}
		console.log(JSON.stringify(out));
	} catch (e) {
		console.error(
			JSON.stringify({
				error: safeMessage(
					e instanceof Error ? e.message : "Browser login failed",
				),
			}),
		);
		process.exitCode = 1;
	}
}
