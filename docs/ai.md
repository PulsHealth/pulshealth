# Use PulsHealth with AI assistants

PulsHealth ships an [MCP](https://modelcontextprotocol.io) server
(`server/mcp/`), so an AI assistant that speaks MCP, such as Claude,
ChatGPT, Cursor or Qwen, can answer questions from your Apple Health data:
"how many steps did I average last week", "compare my runs this month to
last month", "did I close my rings yesterday". It is read-only and talks
only to the product API, never to the database. This page is the
client-side setup; the server's own README is
[`server/mcp/README.md`](../server/mcp/README.md).

For an assistant reading about the project rather than your data, the
repository's [`llms.txt`](../llms.txt) indexes the documentation, and
pulshealth.com serves it at <https://pulshealth.com/llms.txt>: the same file,
rendered at build time with its links pointed at the pages the site renders
under `/docs/` (the file on GitHub where there is none), so an assistant can
follow them from either copy. [`AGENTS.md`](../AGENTS.md) is the companion
for an assistant contributing to the code.

## Connect an AI assistant to your PulsHealth account

If your iPhone syncs to the PulsHealth database (you signed in on
**Sync → Database** in the app, or have an account at
<https://app.pulshealth.com>), there is nothing to install or run. The MCP
server is already up at:

```
https://mcp.pulshealth.com/mcp
```

**Any MCP client.** Add it as a remote MCP server (some apps call this a
custom connector) with the URL above and no token. When the client
connects, a PulsHealth page opens: sign in with your PulsHealth account,
check the app named on it, and choose **Allow**. You do this once per app.
The assistant can then read your data, and only yours, until you revoke it.

The PulsHealth sign-in is a standard OAuth server (the MCP authorization
spec, with dynamic client registration and PKCE), so the client registers
itself and there is nothing to copy across. Any client that supports signing
in to a remote MCP server should connect this way. Claude is the one it has
been tested with; its steps are below. Clients that only take a pasted token
cannot use the hosted server.

**Example: the Claude app (iPhone, Android, desktop, claude.ai)**

1. On claude.ai, open **Settings → Connectors** and choose **Add custom
   connector**.
2. Name it `PulsHealth`, paste the URL above, leave the advanced OAuth
   fields empty, and choose **Add**.
3. Choose **Connect**. A PulsHealth page opens: sign in, check the app named
   on it, and choose **Allow**.

Connectors follow your Claude account, so it appears in the mobile and
desktop apps too. Turn it on for a chat from the tools menu in the message
box, then ask, for example, *"How did I sleep last week?"* Custom connectors
are a feature of Claude's plans; Anthropic's help pages say which ones.

**Example: Claude Code**

```bash
claude mcp add --transport http -s user pulshealth https://mcp.pulshealth.com/mcp
```

Then, in any session, run `/mcp`, pick `pulshealth` and choose
**Authenticate**: the same sign-in and **Allow** page opens in your browser.
`claude mcp list` shows it as connected afterwards.

**What you are allowing.** Read-only access to everything on your account:
the health data your iPhone synced and your profile (name, date of birth).
Nothing can be written or deleted, and nobody else's records are reachable.
What the assistant reads goes to its provider (Anthropic for Claude, OpenAI
for ChatGPT, and so on) under that provider's terms. The
[privacy policy](https://pulshealth.com/privacy) has the details.

**Disconnecting.** Your account page at <https://app.pulshealth.com/account>
lists every connected assistant under **AI assistants**, with **Revoke**. The
assistant cannot renew its access after that, and the access it already
holds expires within 30 minutes. Changing your password or deleting your
account disconnects every assistant.

The rest of this page is for people running their own PulsHealth database.

## What is available today

| Ask about | Tool the assistant uses |
|---|---|
| Who has data on the server, if more than one person does | `list_users` |
| Which data exists, how current it is, what day it is | `list_available_types` |
| How the last week or month went, in one page | `get_summary` |
| Who the data belongs to (name, age, sex) | `get_profile` |
| Current weight, resting heart rate, HRV, VO2 max, blood oxygen, ... | `get_latest_metrics` |
| Daily steps, energy, distance, exercise minutes, heart-rate averages, weight trend, ... | `get_daily_metrics` |
| Activity rings and goals per day | `get_activity_rings` |
| Workouts, filtered by date and activity | `list_workouts` |
| One workout's heart rate / power / pace statistics, laps, pauses | `get_workout` |
| The second-by-second curves inside one workout | `get_workout_series` |
| Sleep by night: time asleep, time in bed, stages | `get_sleep` |
| The individual records of one type, raw | `get_samples` |
| Logged moods and emotions | `get_state_of_mind` |

Daily values are the deduplicated ones (no iPhone + Watch double counting),
every value carries its unit, and dates are calendar days in your
`PULS_TIME_ZONE`. Sleep follows Apple Health: a night is dated by the day you
wake up, and where several devices recorded the same night nothing is summed
across them. `get_samples` is the one tool that returns undeduplicated
records; that is what makes it useful for looking at particular readings and
useless for totals. The assistant can also read `pulshealth://guide`, a short
manual on the data model and its traps, and two ready-made prompts
(`weekly_summary`, `compare_workouts`).

When several phones sync to one server, every tool takes an optional `user`
(a `user_id` from `list_users`); without it the assistant reads the API's
default person. The API only honours another user when its `PULS_MULTI_USER`
is on, and an MCP instance can be pinned to one person with `PULS_USER_ID`
(`PULS_MCP_USER_ID` for the Compose service) so that a connector you hand
to one household member can never be asked about another.

**Not yet:** GPS routes, medication doses, ECGs and heartbeat series. They
are in the database; no tool serves them.

For a whole range as a *file* rather than an answer in a chat (a spreadsheet,
a notebook, something to attach), use `GET /v1/export` or the `puls-export`
CLI instead of a tool call: [`export.md`](export.md).

## No MCP at all: paste a summary

Any chat can read markdown. `GET /v1/summary` renders the last 7, 14, 30 or
90 days as one page of under sixty lines (activity, heart, sleep, workouts,
body and a coverage line, every figure with its unit and already
deduplicated across iPhone and Watch), so a chat with no connector at all
gets a usable picture from one `curl` and a paste:

```bash
curl -H "Authorization: Bearer $PULS_API_TOKEN" "$API/v1/summary?range=7d"
```

`range` is `7d` (the default), `14d`, `30d` or `90d`; `format=json` returns
the same numbers as a `Summary` object. The page carries averages and totals
only, and the header says which calendar days and which time zone it covers,
so the model does not have to guess either. Add `user=<uuid>` on a shared
server, under the same `PULS_MULTI_USER` rule as every other route. The MCP
server exposes the same page as `get_summary`, and
[`notebooks/healthkit_database_exploration.ipynb`](../notebooks/healthkit_database_exploration.ipynb)
renders it straight from the database at the end of its analyses, with an
optional cell that sends it to Claude.

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
   client side. Clients that only sign in (claude.ai, the Claude mobile app)
   use OAuth through the web viewer: "Hosted connectors (OAuth)" below.

### Get the binary

```bash
# from a checkout
go build -o pulshealth-mcp ./server/mcp && sudo mv pulshealth-mcp /usr/local/bin/

# or the latest commit on main (the binary lands as $(go env GOPATH)/bin/mcp)
go install github.com/PulsHealth/pulshealth/server/mcp@latest
```

Go 1.26 or newer. Check it with `PULS_API_TOKEN=x pulshealth-mcp --version`.

Every stdio snippet below uses the same two variables: `PULS_API_URL`
(the product API) and `PULS_API_TOKEN` (from `server/.env`). The calendar
zone needs no setting: the MCP server asks the API for it (`GET /v1/users`
reports the stack's `PULS_TIME_ZONE`, which the API checks against the
database when it starts). Setting `PULS_TIME_ZONE` here overrides that, and a
value that differs from the API's is logged as a warning.

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
        "PULS_API_TOKEN": "<PULS_API_TOKEN from server/.env>"
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
        "PULS_API_TOKEN": "<PULS_API_TOKEN from server/.env>"
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
openssl rand -hex 32            # → PULS_MCP_TOKEN in .env (scripts/bootstrap.sh generates it)
docker compose up -d mcp        # pulls ghcr.io/pulshealth/mcp; `make dev-up` builds it from the checkout
curl -s localhost:8082/healthz  # → {"api":true,"ok":true}
```

The service binds to loopback and depends on `api`. Publish it the same way
as the product API and Grafana: through a TLS-terminating proxy, never
directly:

```bash
tailscale serve --bg --https=8445 http://localhost:8082
```

The endpoint is then `https://<machine>.<tailnet>.ts.net:8445/mcp` with
`Authorization: Bearer $PULS_MCP_TOKEN`. Any reverse proxy that terminates
TLS works the same (Caddy, nginx, a cloud tunnel); keep `/healthz` reachable
for monitoring if you like, it needs no token. Wrong tokens are throttled per
client address like the API's (ten, then one every six seconds, `429` with
`Retry-After`) and logged, but not a request with no token (an OAuth
client's discovery request) or an access token the server signed, valid or
expired, so connectors sharing an address never lock each other out; behind a proxy that is the only way in, set
`TRUST_PROXY_HEADERS=true` so each client keeps its own budget instead of
sharing the proxy's.

Clients that take a static bearer header (Claude Code, Cursor, the MCP
Inspector, your own code) connect as shown above. Clients that take no
header, only an OAuth sign-in (claude.ai's connectors and the Claude mobile
app, for example), are in the next section.

Quick check from a shell:

```bash
curl -s -X POST https://<machine>.<tailnet>.ts.net:8445/mcp \
  -H "Authorization: Bearer $PULS_MCP_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

A `401` means the token; a `503` from `/healthz` means the product API (or
its database) is down.

### Hosted connectors (OAuth): clients that sign in instead of taking a token

Some clients take no pasted token and only sign in with OAuth, following the
MCP authorization spec. claude.ai's custom connectors (which the Claude
mobile app then uses too) are one: they connect from Anthropic's cloud. The
server speaks it, so any client that signs in this way can use it. The web
viewer in accounts mode is the **authorization server**: a person signs in
there with their own viewer account and approves the assistant, and the
viewer issues it a 30-minute access token (renewed with a refresh token).
The `mcp` service is the **resource server**: it checks each token's
signature with a secret it shares with the viewer, without a database, and
reads **only the signed-in person's data**: every API call names them, a
tool asking about anyone else is refused, and `list_users` shows them alone.
`PULS_MCP_TOKEN` keeps working beside it for the clients above.

What it needs:

- **The viewer in accounts mode on a public HTTPS address**
  (`WEB_ACCOUNTS=true`, `WEB_PUBLIC_URL=https://viewer.example.com`; see
  `server/README.md`, "The web viewer on your own domain"). People sign in
  there, so their accounts are the ones `make web-invite` (or approved
  sign-ups) created.
- **The MCP server on a public HTTPS address.** The client's provider makes
  the calls from its own servers (Anthropic's, for claude.ai), so a
  tailnet-only or loopback URL will not do. With the Compose
  `tunnel` profile already serving the viewer, add a second published route
  on the same Cloudflare tunnel: `mcp.example.com` → `http://mcp:8082`
  (port 8082 stays on loopback; Cloudflare terminates TLS and so sees the
  traffic). Any other TLS-terminating proxy works too; keep
  `TRUST_PROXY_HEADERS=true` when it is the only way in.
- **Two lines in `server/.env`**, read by both `web` and `mcp`:

  ```bash
  PULS_MCP_OAUTH_SECRET=<openssl rand -hex 32>
  PULS_MCP_URL=https://mcp.example.com/mcp   # the exact URL you give the connector
  ```

  The issuer is the viewer's `WEB_PUBLIC_URL` (Compose passes it as
  `PULS_MCP_OAUTH_ISSUER`). Then `docker compose up -d`. The `mcp` log's
  `listening` line names the URL and the issuer under `oauth` (`off` when
  it is not on), and
  `curl -s https://mcp.example.com/.well-known/oauth-protected-resource/mcp`
  returns the resource document naming the viewer.
- **`PULS_MULTI_USER=true`** on the API for anyone but the default user
  (`PULS_USER_ID`): otherwise the API refuses their reads (a `403` in the
  tool's error). With it on, `PULS_MCP_TOKEN` can read everyone, so pin it:
  `PULS_MCP_USER_ID=<the person it is for>`.

Any client that signs in connects the same way: give it the URL, sign in
to the viewer, choose **Allow**. Two examples:

**claude.ai and the mobile app.** Settings → Connectors → **Add custom
connector**; give it a name and the URL (`https://mcp.example.com/mcp`) and
leave the advanced OAuth fields (client ID and secret) empty: the client
registers itself. **Connect** opens the viewer's sign-in and a consent page
naming the client; **Allow** returns you to Claude. The connector then
appears in the Claude mobile app on the same account. Each person who uses
it connects with their own viewer account and sees only their own data.

**Claude Code.**

```bash
claude mcp add --transport http pulshealth https://mcp.example.com/mcp
```

then `/mcp` inside a session, choose `pulshealth` and **Authenticate**: the
same sign-in and consent in your browser.

Things to know:

- **Revocation takes up to 30 minutes.** The account page's AI assistants
  list revokes a connection, and disabling, deleting or resetting the password
  of an account revokes all of its connections; the refresh is refused at
  once, but an access token already issued is valid until it expires (at
  most 30 minutes), because the MCP server does not ask the database. Rotating
  `PULS_MCP_OAUTH_SECRET` (`docker compose up -d web mcp`) ends every access
  token immediately.
- **Your data passes through the AI provider.** Every answer a tool gives
  (readings, workouts, sleep, your profile's name and date of birth) goes to
  whoever runs the client (Anthropic, for Claude) to be read by the model, under that
  provider's terms and retention, exactly as with any other connector. The
  consent page says what is shared; connect only if that is acceptable.
- **The grant is read-only and all-or-nothing:** one scope, `health:read`,
  covering every type the server holds for you.

## ChatGPT: the product API as a custom GPT Action

ChatGPT does not speak to the MCP server with a pasted bearer token. What it
does take is an **Action**: an OpenAPI document plus a credential, from which
it calls the HTTP API itself. The product API already publishes the document.
Read the caveats first: this route works differently from everything above.

**OpenAI's servers, not your browser, fetch the document and call the
endpoints.** A tailnet-only URL (`https://<machine>.<tailnet>.ts.net:8444`),
a loopback address or an SSH tunnel **will not work**: import fails, and even
if it did not, every call would. The API has to be reachable from the public
internet for as long as the Action is in use.

### 1. Publish the API on a public HTTPS URL

Any TLS-terminating tunnel or proxy does: `tailscale funnel --bg --https=443
http://localhost:8081`, a Cloudflare Tunnel, or a reverse proxy on a VPS.
Treat this as a temporary window; see the caveats.

```bash
curl -s https://health.example.net/healthz                     # {"ok":true,"db":true}
curl -s https://health.example.net/openapi.json | python3 -m json.tool >/dev/null && echo "schema ok"
```

The document fills its `servers[0].url` in from the request it arrived on
(honouring `X-Forwarded-Host` / `X-Forwarded-Proto`), so **fetch it through
the public URL**: a copy pulled from `127.0.0.1` names the loopback address
and the Action will call the wrong host.

### 2. Import it

In ChatGPT: **Create a GPT → Configure → Create new action → Import from
URL**, and give it `https://health.example.net/openapi.json`. (Pasting the
JSON works too.) Every endpoint arrives with an `operationId` the model calls
by name: `getDailyMetrics`, `getSleepNights`, `listWorkouts`,
`exportDataset` and so on.

### 3. Configure the token

**Authentication → API Key → Auth Type: Bearer**, and paste the value of
`PULS_API_TOKEN` from `server/.env`. That single token is the whole trust
boundary; `/`, `/docs`, `/openapi.json` and `/healthz` stay open, everything
under `/v1/` needs it.

ChatGPT asks for a privacy policy URL for the Action before it will let you
share the GPT with anyone else. Don't; see the caveats.

### 4. Check it

Ask *"what health data do you have about me, and how current is it?"*: that
is one `listCatalogTypes` call, which lists every type with the row count and
the timestamps of its oldest and newest record. Approve the first call when
ChatGPT asks. (Unlike the MCP tool of the same shape, the raw endpoint does
*not* report the server's current date: `latest` is the newest **data**, so an
assistant that reads it as "today" is wrong by however far sync has lagged.)

### Caveats

- **Keep the GPT private.** The API key is stored with the Action, so anyone
  who can use the GPT can read your health data, including your name, email
  and date of birth from `/v1/profile`. Do not share or publish it.
- **Rotate the token afterwards.** It has been handed to a third party and
  travelled over a public endpoint. When you are done: generate a new one
  (`openssl rand -hex 32`), set `PULS_API_TOKEN` in `server/.env`,
  `docker compose up -d api mcp`, and update your other clients. Take the
  public endpoint down at the same time (`tailscale funnel --https=443 off`).
- **A public endpoint is a public endpoint.** The product API throttles
  failed token guesses per client IP (`server/README.md`, "Rate limiting")
  and nothing else: no IP allowlist, no limit on requests that carry the
  right token. The token is all that stands between the internet and the
  data. Keep the window short.
- **Actions time out (tens of seconds) and truncate large answers.** Ask for
  narrow ranges. `exportDataset` streams a CSV or JSONL *file*, which is
  exactly the wrong shape for a chat turn. Use the JSON endpoints for
  questions and the `puls-export` CLI for files ([`export.md`](export.md)).
- **Dates are epoch milliseconds.** The server's calendar zone is the
  `timeZone` field of `listUsers`; tell the GPT in its instructions to read
  it (or name the zone, `PULS_TIME_ZONE`, outright), or it will guess.
- **The Action can name a user.** Every `/v1/*` operation takes an optional
  `user` query parameter and `listUsers` names everyone with data, so a GPT
  built on a shared server can read another household member's records if
  the API's `PULS_MULTI_USER` is on: one more reason to keep the GPT
  private. Leave `PULS_MULTI_USER` off unless you mean it.
- The MCP server remains the better route wherever the client supports it:
  it speaks calendar days, keeps the model honest about units and
  double counting, and never needs a public endpoint.

## Try these

- **"What data do you have about me, and how current is it?"** One
  `list_available_types` call; a good first question, it also tells the
  assistant today's date.
- **"How have I been doing this month?"** One `get_summary` call with
  `range: 30d`; the same page `GET /v1/summary` serves, so it is also the
  thing to paste into a chat that has no connector.
- **"How did I sleep last week?"** One `get_sleep` call for the seven
  days; each row is a night, dated by the morning you woke up, with time
  asleep, time in bed and the core / deep / REM split in minutes. The
  `weekly_summary` prompt includes it.
- **"When exactly did my heart rate spike during yesterday's meeting?"**
  `get_samples` with `HKQuantityTypeIdentifierHeartRate` for that day; the
  individual readings, not a daily average.
- **"Show me how my heart rate moved through Saturday's run."**
  `list_workouts` for the day, then `get_workout_series` with the uuid.
- **"Compare my runs this month to last month."** Two `list_workouts`
  calls with `activity_type: running`, then totals, averages and pace;
  `get_workout` on a few for heart rate. The `compare_workouts` prompt does
  exactly this.
- **"Did I close my rings yesterday?"** `get_activity_rings` for one day;
  closed means value ≥ goal.
- **"What's my resting heart rate trend over the last 90 days?"**
  `get_daily_metrics` with `HKQuantityTypeIdentifierRestingHeartRate` and
  `HKQuantityTypeIdentifierHeartRateVariabilitySDNN`.
- **"How much did I weigh at the start of the year versus now?"**
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
  not a total. The tool descriptions spell all of this out.
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
- With the API's `PULS_MULTI_USER` off (the default) the assistant sees one
  person only. With it on, pin each connector to its person (`PULS_USER_ID`;
  see the multi-user note above). An OAuth sign-in is always pinned to the
  person who signed in. Nothing here can write to the database or to Apple
  Health.
- **A hosted connector sends your data to its provider** and is revoked with
  up to 30 minutes' delay; see "Hosted connectors (OAuth)".

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The tool returns `product API returned 401 ...` | `PULS_API_TOKEN` given to the MCP server differs from the API's. |
| `product API unreachable at ...` | Wrong `PULS_API_URL`, tunnel not up, or the API container is down (`docker compose ps`). |
| `PULS_MCP_TOKEN (or OAuth: …) must be set to serve --http` at startup | HTTP mode refuses to run without its token; set it in `.env`. |
| `OAuth needs all of PULS_MCP_OAUTH_SECRET, PULS_MCP_URL and PULS_MCP_OAUTH_ISSUER` at startup | One of the OAuth settings is set without the others; the issuer comes from `WEB_PUBLIC_URL`. |
| The client (claude.ai, say) cannot connect, or never shows a sign-in | The MCP URL is not reachable from the internet, or OAuth is off (`/.well-known/oauth-protected-resource/mcp` is a 404); check the `mcp` log's `listening` line. |
| A signed-in connector's tools fail with a `403` from the product API | The person is not the API's default user and `PULS_MULTI_USER` is off. |
| Daily figures are off by a day, or a day splits in two | `PULS_TIME_ZONE` set on the MCP server differs from the stack's (its log warns); unset it to use the API's. |
| A tool fails with `could not learn the server's time zone` | The MCP server could not reach `GET /v1/users` to ask for the zone; it tries again on the next call. Fix the API connection, or set `PULS_TIME_ZONE`. |
| Client shows the server as failed to start | Run it by hand with the same env: errors go to stderr as JSON. `pulshealth-mcp --version` checks the binary. |
