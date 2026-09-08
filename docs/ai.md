# Use PulsHealth with AI assistants

PulsHealth ships an [MCP](https://modelcontextprotocol.io) server
(`server/mcp/`) so that Claude Desktop, Claude Code, Cursor, and any other
MCP client can answer questions from your Apple Health data — "how many
steps did I average last week", "compare my runs this month to last month",
"did I close my rings yesterday" — against the server you run. It is
read-only and talks only to the product API, never to the database. This
page is the client-side setup; the server's own README is
[`server/mcp/README.md`](../server/mcp/README.md).

## What is available today

| Ask about | Tool the assistant uses |
|---|---|
| Which data exists, how current it is, what day it is | `list_available_types` |
| Who the data belongs to (name, age, sex) | `get_profile` |
| Current weight, resting heart rate, HRV, VO2 max, blood oxygen, ... | `get_latest_metrics` |
| Daily steps, energy, distance, exercise minutes, heart-rate averages, weight trend, ... | `get_daily_metrics` |
| Activity rings and goals per day | `get_activity_rings` |
| Workouts, filtered by date and activity | `list_workouts` |
| One workout's heart rate / power / pace statistics, laps, pauses | `get_workout` |

Daily values are the deduplicated ones (no iPhone + Watch double counting),
every value carries its unit, and dates are calendar days in your
`PULS_TIME_ZONE`. The assistant can also read `pulshealth://guide`, a short
manual on the data model and its traps, and two ready-made prompts
(`weekly_summary`, `compare_workouts`).

**Not yet:** sleep. Sleep stages are category samples, which the product API
does not serve yet (planned as SRV-13 in
[`docs/open-source-plan.md`](open-source-plan.md), together with a bounded
raw-sample window, per-workout streams and State of Mind). Ask "how did I
sleep last week?" today and the assistant should say so and offer what is
recorded during sleep — resting heart rate, HRV, wrist temperature.

## Two ways to connect

1. **Local binary (stdio).** The assistant launches `pulshealth-mcp` on
   your machine; it needs to reach the product API. Simplest when the API
   is published on your tailnet
   (`tailscale serve --bg --https=8444 http://localhost:8081` on the server,
   as in `server/README.md`) or through an SSH tunnel
   (`ssh -N -L 8081:127.0.0.1:8081 <user>@<host>`, then
   `PULS_API_URL=http://127.0.0.1:8081`).
2. **Remote connector (streamable HTTP).** The Compose stack's `mcp`
   service serves `/mcp` on `127.0.0.1:8082`; publish it over HTTPS and any
   client that can send a bearer header connects to it. No binary on the
   client side.

### Get the binary

```bash
# from a checkout
go build -o pulshealth-mcp ./server/mcp && sudo mv pulshealth-mcp /usr/local/bin/

# or, once a release is tagged (the binary lands as $(go env GOPATH)/bin/mcp)
go install github.com/PulsHealth/pulshealth/server/mcp@latest
```

Go 1.26 or newer. Check it with `PULS_API_TOKEN=x pulshealth-mcp --version`.

Every stdio snippet below uses the same three variables: `PULS_API_URL`
(the product API), `PULS_API_TOKEN` (from `server/.env`) and
`PULS_TIME_ZONE` (the same value the stack runs with — the API does not
report its zone, so the server has to be told; it defaults to UTC).

### Claude Desktop

Edit `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`; Windows:
`%APPDATA%\Claude\claude_desktop_config.json`), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "pulshealth": {
      "command": "/usr/local/bin/pulshealth-mcp",
      "env": {
        "PULS_API_URL": "https://<machine>.<tailnet>.ts.net:8444",
        "PULS_API_TOKEN": "<PULS_API_TOKEN from server/.env>",
        "PULS_TIME_ZONE": "Europe/Berlin"
      }
    }
  }
}
```

The tools appear under the connector icon in the chat box; ask something and
approve the first tool call.

### Claude Code

Stdio, available in every project (`-s user`):

```bash
claude mcp add pulshealth -s user \
  -e PULS_API_URL=https://<machine>.<tailnet>.ts.net:8444 \
  -e PULS_API_TOKEN=<PULS_API_TOKEN from server/.env> \
  -e PULS_TIME_ZONE=Europe/Berlin \
  -- /usr/local/bin/pulshealth-mcp
```

Or the remote connector, with the MCP token as a header:

```bash
claude mcp add --transport http pulshealth https://<machine>.<tailnet>.ts.net:8445/mcp \
  --header "Authorization: Bearer <PULS_MCP_TOKEN from server/.env>"
```

`claude mcp list` shows the connection; `/mcp` inside a session shows the
tools. Try `/mcp__pulshealth__weekly_summary` for the built-in prompt.

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "pulshealth": {
      "command": "/usr/local/bin/pulshealth-mcp",
      "env": {
        "PULS_API_URL": "https://<machine>.<tailnet>.ts.net:8444",
        "PULS_API_TOKEN": "<PULS_API_TOKEN from server/.env>",
        "PULS_TIME_ZONE": "Europe/Berlin"
      }
    }
  }
}
```

Remote instead:

```json
{
  "mcpServers": {
    "pulshealth": {
      "url": "https://<machine>.<tailnet>.ts.net:8445/mcp",
      "headers": { "Authorization": "Bearer <PULS_MCP_TOKEN from server/.env>" }
    }
  }
}
```

### Remote connector: the Compose service over HTTPS

On the server:

```bash
cd server
openssl rand -hex 32            # → PULS_MCP_TOKEN in .env
docker compose up -d --build mcp
curl -s localhost:8082/healthz  # → {"api":true,"ok":true}
```

The service binds to loopback and depends on `api`. Publish it the same way
as the product API and Grafana — through a TLS-terminating proxy, never
directly:

```bash
tailscale serve --bg --https=8445 http://localhost:8082
```

The endpoint is then `https://<machine>.<tailnet>.ts.net:8445/mcp` with
`Authorization: Bearer $PULS_MCP_TOKEN`. Any reverse proxy that terminates
TLS works the same (Caddy, nginx, a cloud tunnel); keep `/healthz` reachable
for monitoring if you like, it needs no token.

Clients that take a static bearer header — Claude Code, Cursor, the MCP
Inspector, your own code — connect as shown above. The hosted connector
screens in claude.ai and ChatGPT expect an OAuth flow rather than a pasted
token; until the server speaks OAuth (or you front it with an OAuth-capable
proxy), use one of the clients above, or the stdio binary.

Quick check from a shell:

```bash
curl -s -X POST https://<machine>.<tailnet>.ts.net:8445/mcp \
  -H "Authorization: Bearer $PULS_MCP_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

A `401` means the token; a `503` from `/healthz` means the product API (or
its database) is down.

## Try these

- **"What data do you have about me, and how current is it?"** — one
  `list_available_types` call; a good first question, it also tells the
  assistant today's date.
- **"How did I sleep last week?"** — not available yet; the assistant
  should say so (see above) and offer resting heart rate, HRV and wrist
  temperature for the same nights instead.
- **"Compare my runs this month to last month."** — two `list_workouts`
  calls with `activity_type: running`, then totals, averages and pace;
  `get_workout` on a few for heart rate. The `compare_workouts` prompt does
  exactly this.
- **"Did I close my rings yesterday?"** — `get_activity_rings` for one day;
  closed means value ≥ goal.
- **"What's my resting heart rate trend over the last 90 days?"** —
  `get_daily_metrics` with `HKQuantityTypeIdentifierRestingHeartRate` and
  `HKQuantityTypeIdentifierHeartRateVariabilitySDNN`.
- **"How much did I weigh at the start of the year versus now?"** —
  `get_latest_metrics` for now, `get_daily_metrics` for January.

## How the server keeps the model honest

- **Units travel with every value** (`count/min`, `kg`, `m`, `kcal`, ...),
  and the descriptions warn that `%` is a fraction (blood oxygen 0.97).
- **Days, not milliseconds.** The API speaks epoch milliseconds and
  half-open ranges; the tools speak `YYYY-MM-DD` in your time zone and map
  an inclusive range to exactly those days, DST included.
- **No double counting.** Daily values come from HealthKit's own daily
  aggregate when the phone synced one, otherwise from a single-source rollup;
  the guide tells the model never to total raw samples itself.
- **Cumulative versus discrete.** Steps are daily sums; heart rate is a
  daily average; the latest raw sample of a cumulative type is an increment,
  not a total — spelled out in the tool descriptions.
- **Errors are readable.** A bad date, an unknown workout, a rejected token
  or an unreachable API come back as tool errors with the reason and the
  HTTP status, so the assistant can explain instead of guessing.

## Security

- **The tokens grant read access to your health data**, including the
  profile (name, email, date of birth). `PULS_API_TOKEN` (used by the stdio
  binary) and `PULS_MCP_TOKEN` (presented by remote clients) are separate
  secrets; rotate either without touching the other.
- **Client config files hold the token.** `claude_desktop_config.json`,
  `.cursor/mcp.json` and Claude Code's settings are as sensitive as
  `server/.env`; keep them out of version control.
- **HTTP mode only behind TLS.** The compose service binds to loopback;
  never publish port 8082 directly or over plain HTTP. See the security
  notes in `server/mcp/README.md`.
- The assistant sees only what the product API serves for `PULS_USER_ID`;
  nothing here can write to the database or to Apple Health.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The tool returns `product API returned 401 ...` | `PULS_API_TOKEN` given to the MCP server differs from the API's. |
| `product API unreachable at ...` | Wrong `PULS_API_URL`, tunnel not up, or the API container is down (`docker compose ps`). |
| `PULS_MCP_TOKEN must be set to serve --http` at startup | HTTP mode refuses to run without its token — set it in `.env`. |
| Daily figures are off by a day, or a day splits in two | `PULS_TIME_ZONE` on the MCP server does not match the stack's. |
| Client shows the server as failed to start | Run it by hand with the same env: errors go to stderr as JSON. `pulshealth-mcp --version` checks the binary. |
| `403 Forbidden: invalid Host header` | Only possible with an older build; the current server disables the SDK's loopback guard for exactly the reverse-proxy case. |
