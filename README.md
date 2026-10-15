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

Enter the SMS code through stdin. When typing directly in a terminal, enter the code, press Enter, then send EOF (Ctrl+D on Unix).

### Headless login (default)

`login start` launches **headless Chrome/Chromium in the background on the machine running the CLI**. No browser window opens, and no desktop or display server is needed. The terminal-only experience still uses a real browser to run Abler’s login page and reCAPTCHA; it is not a browser-free authentication flow.

Install Chrome/Chromium on that machine before logging in. On Linux, common system executable paths are detected automatically. For another installation location, set the executable explicitly:

```sh
export ABLER_CHROME="/path/to/chromium"
abler login start --phone "$ABLER_PHONE"
abler login verify --stdin
abler doctor
abler login close
```

Node.js, the installed project dependencies, and the built login helper must also be available. A headless browser still needs its operating-system shared libraries. Keep the same login browser running between `start` and `verify`; closing it before verification loses the pending form. After successful verification, close it with `login close`: normal API and MCP requests use the saved session without a browser.

### Interactive challenges

Headless login is not guaranteed to pass every reCAPTCHA assessment. If a challenge requires human interaction, use a computer with a display and launch visibly:

```sh
abler login start --phone "$ABLER_PHONE" --headed
```

Complete the challenge in that browser, then verify the received code through the CLI. Do not repeatedly request codes if one is already pending. `--headed` needs a usable graphical display; it does not provide a remote viewer on a headless server.

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

## Write actions

Write support is included in both the CLI and MCP server. Most writes use the **generic mutation executor**, not separate action-specific MCP tools.

| Action | Catalog operations |
| --- | --- |
| Respond to attendance and add a comment | `SetPlayerAttendance`, `setPlayerAttendanceV3` |
| Compose a message or reply to a conversation | `MessageCompose`, `MessageReply` |
| Mark a conversation or all conversations as read | `MarkAsRead`, `MarkAllAsRead` |
| Update profile information and preferences | `updateUser`, `UserSettingsUpdate` |
| Join or leave an event | `UserJoinEvent`, `UserLeaveEvent` |
| Manage events, groups, members, invitations, and resources | Additional catalog mutations; account permissions apply |
| Manage registrations, subscriptions, invoices, and payments | Additional catalog mutations; account permissions apply |

These are available request contracts, not a guarantee that every action is supported for every account. Inspect the exact variables first:

```sh
abler operations list --kind mutation --search message
abler operations show MessageReply
abler operations show SetPlayerAttendance
```

### CLI writes

Mutations are blocked unless `--yes` is supplied. Use `--dry-run` to review the request without network access:

```sh
abler run MessageReply --vars-file /path/to/reply.json --dry-run
# Execute only after reviewing and approving the recipient/thread and text:
abler run MessageReply --vars-file /path/to/reply.json --yes
```

Example `reply.json` (replace the placeholder with a conversation ID from your account):

```json
{
  "conversationId": "CONVERSATION_ID",
  "messageText": "Your approved reply"
}
```

Attendance also has a CLI alias:

```sh
abler attendance set --vars-file /path/to/attendance.json --dry-run
abler attendance set --vars-file /path/to/attendance.json --yes
```

`attendance set` calls `SetPlayerAttendance`. Its `id` is an **attendance-record ID**, not an event ID. Inspect the operation contract and use valid IDs and status values from your account.

Mutations are never automatically retried. Agents should obtain approval for the exact action and arguments before executing writes.

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

### Enable MCP writes

The default MCP server is read-only. Start it with `--allow-writes` to add the write tool:

```sh
abler mcp --allow-writes
```

Or enable writes in your MCP client configuration:

```json
{
  "mcpServers": {
    "abler": {
      "command": "abler",
      "args": ["mcp", "--allow-writes"]
    }
  }
}
```

| Write tool | Inputs | Behavior |
| --- | --- | --- |
| `abler_mutate` | `operation`, `variables`, optional `endpoint`, optional `confirm` | Dry-run by default; executes only with `confirm: true` |

Example MCP tool call for reviewing a reply:

```json
{
  "name": "abler_mutate",
  "arguments": {
    "operation": "MessageReply",
    "variables": {
      "conversationId": "CONVERSATION_ID",
      "messageText": "Your approved reply"
    },
    "confirm": false
  }
}
```

After approving the exact conversation and text, make the same call with `confirm: true` to send it. Without `--allow-writes`, `abler_mutate` is not exposed at all. `abler_query` cannot execute mutations.

Authentication remains a CLI workflow. MCP configuration must be added to each client that should connect to the server.

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
