# Abler CLI + MCP

A command-line client and Model Context Protocol server for Abler. Read schedules, events, attendance, family memberships, and conversations, with JSON output for scripts and agents.

## Requirements

- Bun to install dependencies and build
- Node.js and Chrome/Chromium for browser-assisted login
- An Abler account with access to the requested resources

## Install

```sh
bun install --frozen-lockfile
bun run check
bun run build
```

Add the resulting `abler` binary to your PATH. Keep the checkout and `dist/login-helper.mjs` available for browser-assisted login.

## Login

```sh
abler login start --phone "$ABLER_PHONE"
# Email addresses are also accepted by --phone.
abler login verify --stdin
abler doctor
```

Enter the SMS code through stdin. Login uses the normal browser flow, including reCAPTCHA. If a challenge requires interaction, use `--headed` on a computer with a display and complete it normally. A pending verification requires the same login browser.

```sh
abler login refresh
abler login close
abler logout
```

After successful login, API access does not require the browser to remain open. `logout` removes the local CLI session; it does not revoke all server sessions or clear browser-profile cookies.

Existing authorized browser storage state can be imported:

```sh
abler login import --file /path/to/private-session.json
```

Session credentials are stored under `~/.config/abler/`, outside the project, with private file permissions. Do not commit session files or browser profiles.

## Common commands

```sh
abler me
abler family
abler groups
abler events --month 10 --year 2026
abler event EVENT_ID
abler attendance EVENT_ID --first 20
abler messages --first 20
abler watch unreadCount --seconds 10 --max-events 1
```

All results are JSON; `--json` is also accepted. Calendar months in `events` are **1–12**. Pagination metadata is preserved; use `--cursor` for subsequent pages. A single page is not necessarily the complete result set.

## Operation catalog

Browse operations and inspect their variables before running them:

```sh
abler operations list --search attendance
abler operations list --kind query --limit 100 --offset 0
abler operations show SetPlayerAttendance
abler schema --search payment
abler run conversationMessages --vars-file /path/to/variables.json
```

Some operations have multiple request variants, identified by a `__HASH` suffix. Entries include the request document, required variables, transport, and availability. Catalog availability does not guarantee that an operation is permitted for your account or accepted by the current API. Operations with incomplete dependencies are blocked.

Generic `run` uses API-native variables. For example, the raw `calendar` operation uses **zero-based months**, unlike the friendly `events` command.

For GraphQL operations, `--endpoint main|auth|reports|partner` selects the service. REST operations use their declared accounting or workout service. Subscriptions use `watch`, with a bounded observation window of 1–60 seconds. Service access is subject to your Abler permissions. Browser-only login operations are unavailable through the generic executor.

## Writes and dry runs

Mutations are blocked unless explicitly confirmed:

```sh
abler run SetPlayerAttendance --vars-file /path/to/action.json --dry-run
abler run SetPlayerAttendance --vars-file /path/to/action.json --yes
```

`attendance set` is an alias for `SetPlayerAttendance`. Its `id` is an **attendance-record ID**, not an event ID. Inspect the operation contract and use valid IDs and status values from your account.

Dry runs validate the request without executing it. Mutations are never automatically retried. Agents should obtain approval for the exact action and arguments before using write commands.

## MCP server

```sh
abler mcp
```

Example client configuration:

```json
{
  "mcpServers": {
    "abler": {
      "command": "abler",
      "args": ["mcp"]
    }
  }
}
```

Read-only tools:

| Tool | Purpose |
| --- | --- |
| `abler_doctor` | Check authentication and API access |
| `abler_me` | Account identity |
| `abler_family` | Children and family links |
| `abler_groups` | Memberships, groups, and roles |
| `abler_events` | Calendar events |
| `abler_event` | Event details |
| `abler_messages` | Conversations and messages |
| `abler_operations` | Paginated operation catalog |
| `abler_query` | Execute a catalog read operation |
| `abler_watch` | Observe a subscription for a bounded interval |

To expose mutation tooling:

```sh
abler mcp --allow-writes
```

This adds `abler_mutate`, which defaults to a dry run and requires `confirm: true` to execute. Authentication remains a CLI workflow. MCP configuration must be added to each client that should connect to the server.

## Configuration

| Variable | Purpose |
| --- | --- |
| `ABLER_CONFIG_DIR` | Override the private configuration directory |
| `ABLER_CHROME` | Chrome/Chromium executable path |
| `ABLER_SOURCE_DIR` | Checkout path when the binary is installed elsewhere |
| `ABLER_NODE` | Node.js executable for the login helper |

Alternatively, set `executablePath` in a private `browser.json` within the configuration directory. The default login browser uses loopback port 9334; `--cdp http://127.0.0.1:PORT` selects another local browser endpoint.

## Checks

```sh
bun run check
bun run build
```
