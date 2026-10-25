# abler-cli

Command-line client and MCP server for [Abler](https://www.abler.io): read schedules, events, attendance, family memberships and conversations as JSON, for scripts and AI agents.

> Unofficial — not affiliated with Abler. The API is undocumented and recovered from the Abler web app; it can change without notice.

## Install

Requires [Bun](https://bun.sh) ≥ 1.1. Browser-assisted login additionally needs [Node.js](https://nodejs.org) and Chrome/Chromium (see [Authentication](#authentication)).

```sh
bun add -g github:axelpaul/abler-cli      # install
bun add -g github:axelpaul/abler-cli      # update (re-run; pulls the latest default branch)
bun remove -g abler-cli                   # uninstall
```

This installs the `abler` command into `~/.bun/bin`. Check it with `abler --version`.

No prebuilt binaries are published. Login drives a real browser through Playwright running under Node.js from the package's `node_modules`, which a single compiled executable cannot carry, so the Bun install above is the supported method. Tagged versions are listed on the [Releases page](https://github.com/axelpaul/abler-cli/releases); install a specific one with `bun add -g github:axelpaul/abler-cli#v0.1.0`.

## Authentication

Abler login is phone/email + SMS code, protected by reCAPTCHA, so it runs in a real browser:

```sh
abler login start --phone "$ABLER_PHONE"   # email addresses are also accepted
abler login verify --stdin                 # type the SMS code, Enter, then Ctrl+D
abler doctor
abler login close
```

On first use the CLI builds a small Node helper (`dist/login-helper.mjs`) inside the installed package; this happens automatically.

### Headless login (default)

`login start` launches **headless Chrome/Chromium in the background on the machine running the CLI**. No window opens and no display is needed, but it is still a real browser running Abler's login page and reCAPTCHA. It needs:

- Chrome or Chromium. `/usr/bin/chromium` and `/usr/bin/google-chrome` are detected; otherwise set `ABLER_CHROME=/path/to/chrome` (on macOS e.g. `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`).
- Node.js on `PATH` (or `ABLER_NODE=/path/to/node`).

Keep the same login browser running between `start` and `verify`; closing it loses the pending form. After verification, close it with `abler login close`. Normal API and MCP requests use the saved session without a browser.

### Interactive challenges

Headless login is not guaranteed to pass every reCAPTCHA assessment. If a challenge needs a human, run on a computer with a display:

```sh
abler login start --phone "$ABLER_PHONE" --headed
```

Complete the challenge in that browser, then verify the code through the CLI. Do not repeatedly request codes while one is pending. `--headed` needs a usable graphical display; it does not give a remote viewer on a headless server.

### Session management

```sh
abler login refresh     # refresh the access token
abler login close       # stop the login browser
abler logout            # delete the local CLI session
abler login import --file /path/to/private-session.json   # import Playwright storage state
```

`logout` removes the local session only; it does not revoke server sessions or clear browser-profile cookies. Sessions are stored in the config directory (see [Configuration](#configuration)) with private file permissions. Do not commit session files or browser profiles.

## CLI usage

```sh
abler me
abler family
abler groups
abler events --month 10 --year 2026
abler events --week 42 --year 2026
abler event EVENT_ID
abler attendance EVENT_ID --first 20
abler messages --first 20
abler watch unreadCount --seconds 10 --max-events 1
abler --help
```

All results are JSON (`--json` is accepted). Calendar months in `events` are **1–12**. Pagination metadata is preserved; use `--cursor` for subsequent pages. A single page is not necessarily the complete result set.

### Operation catalog

Browse operations and inspect their variables before running them:

```sh
abler operations list --search attendance
abler operations list --kind query --limit 100 --offset 0
abler operations show SetPlayerAttendance
abler schema --search payment
abler run conversationMessages --vars-file /path/to/variables.json
```

Some operations have multiple request variants, identified by a `__HASH` suffix. Entries include the request document, required variables, transport and availability. Catalog availability does not guarantee that an operation is permitted for your account or accepted by the current API. Operations with incomplete dependencies are blocked.

Generic `run` uses API-native variables. For example, the raw `calendar` operation uses **zero-based months**, unlike the friendly `events` command.

For GraphQL operations, `--endpoint main|auth|reports|partner` selects the service. REST operations use their declared accounting or workout service. Subscriptions use `watch`, with a bounded observation window of 1–60 seconds. Browser-only login operations are unavailable through the generic executor.

### Write actions

Most writes go through the generic mutation executor:

| Action | Catalog operations |
| --- | --- |
| Respond to attendance and add a comment | `SetPlayerAttendance`, `setPlayerAttendanceV3` |
| Compose a message or reply to a conversation | `MessageCompose`, `MessageReply` |
| Mark a conversation or all conversations as read | `MarkAsRead`, `MarkAllAsRead` |
| Update profile information and preferences | `updateUser`, `UserSettingsUpdate` |
| Join or leave an event | `UserJoinEvent`, `UserLeaveEvent` |
| Manage events, groups, members, invitations and resources | Additional catalog mutations; account permissions apply |
| Manage registrations, subscriptions, invoices and payments | Additional catalog mutations; account permissions apply |

These are recovered request contracts, not a guarantee that every action works for every account. Mutations are blocked unless `--yes` is supplied; `--dry-run` shows the request without network access:

```sh
abler operations show MessageReply
abler run MessageReply --vars-file /path/to/reply.json --dry-run
# Execute only after reviewing the recipient/thread and text:
abler run MessageReply --vars-file /path/to/reply.json --yes
```

Example `reply.json` (use a conversation ID from your account):

```json
{
  "conversationId": "CONVERSATION_ID",
  "messageText": "Your approved reply"
}
```

Attendance has a CLI alias:

```sh
abler attendance set --vars-file /path/to/attendance.json --dry-run
abler attendance set --vars-file /path/to/attendance.json --yes
```

`attendance set` calls `SetPlayerAttendance`. Its `id` is an **attendance-record ID**, not an event ID. Mutations are never retried automatically.

## MCP server

```sh
abler serve     # stdio MCP server; `abler mcp` is an alias
```

| Tool | Read/write | Description |
| --- | --- | --- |
| `abler_doctor` | read | Check the saved session and API access |
| `abler_me` | read | Account identity |
| `abler_family` | read | Children and family links |
| `abler_groups` | read | Memberships, groups and roles |
| `abler_events` | read | Calendar events (month 1–12, week, year, cursor, filter) |
| `abler_event` | read | Event details by ID |
| `abler_attendance` | read | Attendance list for an event |
| `abler_messages` | read | Conversations and messages (does not send) |
| `abler_operations` | read | Paginated operation catalog |
| `abler_operation` | read | One operation's variables and GraphQL document |
| `abler_query` | read | Execute a catalog query (mutations are rejected) |
| `abler_watch` | read | Observe a subscription for a bounded interval |
| `abler_mutate` | write | Execute a catalog mutation; dry-run unless `confirm: true`. Only registered when writes are enabled |

Not exposed over MCP: `login`/`logout` (interactive, needs the SMS code and possibly a browser challenge; run them in a terminal once). `operations list --kind subscription` items are reachable through `abler_watch`.

### Enable writes

The server is read-only by default. Set `ABLER_MCP_ENABLE_WRITES=1` (or pass `--allow-writes`) to register `abler_mutate`. Every call returns a dry-run plan unless it includes `confirm: true`; agents should get user approval for the exact operation and variables first.

```json
{
  "name": "abler_mutate",
  "arguments": {
    "operation": "MessageReply",
    "variables": { "conversationId": "CONVERSATION_ID", "messageText": "Your approved reply" },
    "confirm": false
  }
}
```

### Client configuration

Claude Code:

```sh
claude mcp add abler -- abler serve
# with writes:
claude mcp add abler -e ABLER_MCP_ENABLE_WRITES=1 -- abler serve
```

Claude Desktop, Cursor and other JSON-configured clients:

```json
{
  "mcpServers": {
    "abler": {
      "command": "abler",
      "args": ["serve"],
      "env": { "ABLER_MCP_ENABLE_WRITES": "1" }
    }
  }
}
```

Omit `env` for read-only. GUI apps may not have `~/.bun/bin` on `PATH`; if the server fails to start, use the absolute path from `which abler` as `command`. Log in with the CLI before starting the server.

## Configuration

| Variable | Purpose |
| --- | --- |
| `ABLER_CONFIG_DIR` | Config/session directory (default `~/.config/abler`) |
| `ABLER_CHROME` | Chrome/Chromium executable for login |
| `ABLER_NODE` | Node.js executable for the login helper (default `node`) |
| `ABLER_SOURCE_DIR` | Package/checkout directory holding `src/` and `dist/`, if the CLI cannot find it |
| `ABLER_MCP_ENABLE_WRITES` | `1` registers the MCP write tool |

Files in the config directory: `session.json` (cookies and access token, mode 0600), `session.lock`, `browser-profile/` (login browser profile) and optionally `browser.json` with `{"executablePath": "..."}` as an alternative to `ABLER_CHROME`. The login browser uses loopback port 9334; `--cdp http://127.0.0.1:PORT` selects another local endpoint.

## Development

```sh
git clone https://github.com/axelpaul/abler-cli
cd abler-cli
bun install --frozen-lockfile
bun run check            # typecheck + tests
bun src/index.ts --help
bun run build:login      # build dist/login-helper.mjs explicitly (otherwise built on first login)
```
