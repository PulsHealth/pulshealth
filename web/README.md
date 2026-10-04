# Puls Web

The self-hosted web viewer for the Puls health store, in the style of Apple
Health. Built with **Next.js (App Router) + TypeScript**, it reads directly
from the same **TimescaleDB** that Grafana uses and draws its own SVG charts:
activity rings, range-banded trend lines and bar series, with per-category
accent colors.

> **Local demo mode.** Outside production, an unset or unreachable `DATABASE_URL`
> serves generated demo data. Production never fabricates health data: a page
> whose data cannot be read shows **Database unavailable** instead of its
> charts.

## Quick start

```bash
cd web
npm install
cp .env.example .env        # optional — leave DATABASE_URL blank for local demo mode
npm run dev                 # http://localhost:3000
```

## Connecting to real data

Point `DATABASE_URL` at the Puls Postgres/TimescaleDB instance (the database is
`postgres`, same as Grafana — see `../server`). A read-only role is ideal.

```bash
# Local docker stack (../server): the database plus its schema
cd ../server && docker compose up -d migrate
# then in web/.env:
DATABASE_URL="postgres://postgres:YOUR_PASSWORD@localhost:5432/postgres?sslmode=disable"

# A remote stack whose Postgres port is bound to loopback: open an SSH tunnel
# and connect through it as the read-only `grafana` role.
ssh -N -L 15432:127.0.0.1:5432 <user>@<host>
DATABASE_URL="postgres://grafana:GRAFANA_DB_PASSWORD@127.0.0.1:15432/postgres?sslmode=disable"
```

Inside the compose stack the `web` service gets `DATABASE_URL` built from
`GRAFANA_DB_PASSWORD` automatically (see `../server/docker-compose.yml`).

`PULS_USER_ID` is the user shown until one is chosen (see "Choosing a user"
below); it defaults to the seeded app user. `PULS_TIME_ZONE` controls Today, greetings, chart buckets,
and day boundaries; it defaults to `UTC` and must match the server stack's
`PULS_TIME_ZONE` (the database exposes its own as `puls_time_zone()`; on a
mismatch the viewer logs a warning and stops using `metric_daily`). The status
dot shows **Live data** (green), **Demo data** (amber), or **Database unavailable**.
A page that cannot read its data — no database, an unreachable one, or one
read that failed or timed out — shows **Database unavailable** in place of
its content (with Try again), never empty charts that would read as "no
data". A failed read also makes the viewer check the database again at once
rather than after its usual 30 seconds, so a pool timeout or a lost database
turns the status dot red from the next page load (and `/api/healthz`
answers 503), while a single slow query fails only the page that ran it.

`WEB_DB_POOL_SIZE` is how many database connections the viewer holds at most
(default 4, clamped to 1–50). A type page runs several reads in parallel, so
a viewer that several people use at once wants more; the database's
`max_connections`, shared with ingest, the API and Grafana, is the ceiling.

## Choosing a user

The database can hold more than one person's records — every phone that syncs
lands its rows under its own `user_id` — and the viewer shows one of them at a
time. Which one:

- **`PULS_USER_ID`** is the default: the user shown until one is chosen.
- **The sidebar's user switcher** appears when the database holds two or more
  users (a single-user install never sees it). Picking one posts to
  `/api/user`, which remembers the choice in a `puls-user` cookie for a year
  — a plain form, so it works without JavaScript — and sends you back to the
  page you were on. Users are listed by name, else e-mail, else the short form
  of their id; both fields stay empty until that phone's first profile sync.
- **`?user=<uuid>`** on any page picks a user the same way and then drops the
  parameter from the URL, so a bookmark or a link from Grafana can open one
  person directly. The id is the one Grafana's `user` variable shows (or
  `SELECT id, name FROM users`). Settings shows whose data is on screen.

**This is a preference, not access control.** Everyone behind the one
`WEB_AUTH_PASSWORD` can look at every user, and the cookie is nothing but the
chosen id (a forged value is at worst an id the database does not have, which
renders empty — with the switcher there to pick a real one). In Basic mode the
viewer cannot limit a person to their own records, so share the password only
with people who may see everything in the database — or use accounts mode.

**None of this applies in accounts mode** (below): there the user is the
signed-in account's, `?user=` and the `puls-user` cookie are ignored, the
switcher and `/api/user` do not exist, and the list of users is never read.

## Access control

The viewer runs in one of three modes, chosen from the environment at every
request (`lib/mode.ts`) and named in its startup log
(`docker compose logs web | grep puls-web`):

| Mode | Set | Who sees what |
|---|---|---|
| **open** | neither variable | Anyone who can reach the port sees every user. Fine on loopback only. |
| **basic** | `WEB_AUTH_PASSWORD` | One shared password; everyone who has it sees every user. |
| **accounts** | `WEB_ACCOUNTS=true` | Each person signs in with their own email and password and sees only their own records — enforced by the database. Invite-only. Wins if both are set. |

Every mode sends the same hardening headers: a per-request
Content-Security-Policy with a script nonce (`proxy.ts`,
`lib/securityHeaders.ts`; scripts run only with the nonce, images only from
this origin and the map's tile servers), and from `next.config.ts`
`Strict-Transport-Security`, `Referrer-Policy: same-origin`,
`X-Content-Type-Options`, `X-Frame-Options: DENY` and a `Permissions-Policy`.

### Basic mode

**`WEB_AUTH_PASSWORD` is a password prompt in front of the whole viewer.** Set
it and every route asks for HTTP Basic credentials; leave it empty and the
viewer has no login at all.

```bash
WEB_AUTH_PASSWORD="$(openssl rand -hex 12)"   # in server/.env
docker compose up -d web
```

`scripts/bootstrap.sh` generates one on a fresh install and prints it with the
pairing block (`make pairing` re-prints it). Details:

- **Any username is accepted** — there is one viewer and one secret, and a
  rejected username would only be a way to lock yourself out. Type anything.
- **`/api/healthz` stays open**, so container health checks and deploy probes
  keep working without credentials. Everything else, including static assets,
  `/api/user` and the `?user=` shortcut, goes through the check.
- The comparison is constant-time (both sides SHA-256'd, then compared
  branch-free), and nothing about a failed attempt is logged — the
  `Authorization` header holds the password, and a near-miss in a log file is
  still a password in a log file.
- The container says which mode it is in at startup:
  `docker compose logs web | grep puls-web`.
- **To turn it off**, empty the value in `.env` and `docker compose up -d web`.
- There is **no logout** (that is Basic auth); close the browser or use a
  private window.

The implementation is `proxy.ts` (Next.js 16's middleware convention) over the
pure helpers in `lib/auth.ts`, which `lib/auth.test.ts` covers.

**This is not a substitute for the bind address.** Basic auth sends the password
on every request, in the clear unless something terminates TLS in front. The
compose stack still binds the viewer to `WEB_BIND_ADDR` (default `127.0.0.1`);
to reach it from other machines, use a private overlay network (Tailscale, a
VPN), an SSH tunnel, or an HTTPS reverse proxy — never `0.0.0.0` on an
untrusted network, and never directly on the internet.

### Accounts mode

For a viewer that more than one person uses, or one on the public internet:
each person has their own account and sees only their own records.

**The database decides what a signed-in person can read.** In accounts mode
the viewer connects as `web_app`, a role with no grant on any table that holds
health data. It reads them only through the per-user, security-barrier views
in schema `web` (`server/db/migrations/015_web_accounts.sql`), filtered on the
`puls.user_id` setting that `scoped()` in `lib/db.ts` puts in every
transaction from the signed-in session. A query here that forgot its
`WHERE user_id` would still return that person's rows and nobody else's, and
one run without the setting returns nothing. The viewer refuses to serve data
in accounts mode while connected as any role that can read the tables
directly (`/api/healthz` says so). What this does **not** defend against is a
compromised viewer: code running as `web_app` can set the user itself.

Turn it on in `server/.env`, then `docker compose up -d`:

```bash
WEB_DB_PASSWORD=...          # bootstrap.sh generates it; creates the web_app role
WEB_ACCOUNTS=true
WEB_DATABASE_URL=postgres://web_app:${WEB_DB_PASSWORD}@db:5432/postgres?sslmode=disable
TRUST_PROXY_HEADERS=true     # behind the TLS proxy that is the only way in
WEB_PUBLIC_URL=https://viewer.example.com
WEB_CLIENT_IP_HEADER=cf-connecting-ip   # behind Cloudflare only
```

**It needs HTTPS.** The session cookie is `Secure`, and a password should
never cross plain HTTP, so accounts mode answers plain-HTTP requests with a
403 — everything but `/api/healthz`. The container itself speaks HTTP, so put
it behind a TLS proxy (a Cloudflare Tunnel — see `server/README.md`,
"Exposing the server" — Tailscale Serve, or a reverse proxy) that is the only
way to reach it, and set `TRUST_PROXY_HEADERS=true` so `X-Forwarded-Proto`,
`X-Forwarded-Host` and the client address are believed. Keep `WEB_BIND_ADDR`
on loopback. `next dev` on `http://localhost` works without a proxy.
`TRUST_PROXY_HEADERS` is read as ingest and the product API read it —
`true`/`1`/`yes`/`on` or `false`/`0`/`no`/`off`, any case, empty for the
default (off) — and any other value stops the viewer at startup with a
message naming it. With it on and the client address taken from
`X-Forwarded-For` (`WEB_CLIENT_IP_HEADER` unset), the viewer logs a warning
at startup: that is right behind exactly one proxy that appends to the
header, but behind Cloudflare (the `tunnel` profile included)
`WEB_CLIENT_IP_HEADER=cf-connecting-ip` is the header Cloudflare always
overwrites, and behind two appending proxies every client would share one
rate-limit bucket.

**Inviting people.** There is no sign-up. An operator runs, for each person:

```bash
make issue-device NAME='Ann’s iPhone' ARGS='--user <uuid>'   # the phone's token; creates the user
make web-invite ARGS='--user <uuid> --email ann@example.com' # a one-time viewer link
```

The second prints `https://<WEB_PUBLIC_URL>/invite/<token>`, valid once for 48
hours (`--hours`); add `--send` to email it to the person instead (through
the SES settings below) so the link never appears in your terminal. Opening it asks for a password (at least 10 characters) and
signs the person in. An invite for a user who already has an account resets
its password and signs it out everywhere — that is the way back in after a
forgotten password, since the viewer sends no email. `--admin` marks the
account as an administrator, which gives it `/admin` (below). Pairing a
household phone stays the operator's step (`make issue-device`); a signed-in
person can also connect their own iPhone from their account page (below).

**Signing in.** `/login`, `/invite/<token>`, their two POST endpoints,
`/api/auth/logout`, build assets and `/api/healthz` are reachable without a
session; everything else redirects to `/login?next=…` (pages) or answers 401.
`/account` changes the password (it needs the current one, and signs out every
other browser) and lists the account's sessions with a sign-out for each.
Details:

- Passwords are hashed with scrypt (N=2¹⁶, r=8, p=2, 32-byte salt) from
  `node:crypto` (`lib/accounts/password.ts`); old parameters are upgraded on
  the next sign-in.
- The session cookie `__Host-puls-session` is `HttpOnly; Secure;
  SameSite=Lax; Path=/` and carries 32 random bytes; the database keeps only
  their SHA-256 (`auth.sessions`). Sessions last 30 days from last use and
  90 days from sign-in at most, however often they are used — checked by the
  viewer on every request and again by every database function below; the
  hourly `auth.prune_signups` job deletes expired rows (with their IP address
  and browser name). Every
  sign-in gets a new session id, signing out deletes the session row (so a
  copy of the cookie stops working), and a password change or an invite
  reset ends every session of the account and starts a fresh one.
- Every state-changing request must carry an `Origin` of this viewer
  (`lib/accounts/request.ts`), on top of `SameSite=Lax`.
- Failed sign-ins, bad invite links and wrong current passwords are throttled
  per client address and per email address, with the same token bucket as
  ingest and the product API (10, refilling 10 a minute; only failures draw,
  and an exhausted bucket is refused before the password is looked at). An
  attempt takes its token before the check and gets it back on success, so
  a burst of parallel guesses cannot all slip past while scrypt runs.
  Nothing about a failed attempt is logged.
- The email bucket would let anyone keep a person signed out (ten wrong
  guesses a minute, from anywhere). So a sign-in from an address one of the
  account's own live sessions signed in from is charged to that address's
  bucket only: the owner gets in from where they already use the viewer
  while strangers keep the email bucket empty. The database is asked only
  when the email bucket is what would refuse the attempt. Not chosen:
  refusing only when both buckets are empty (a botnet of fresh addresses
  could then guess at one account without limit), or a slower email bucket
  (any finite refill can be held empty; it only changes the price). The
  cost: someone sharing a known address (the same NAT) skips the email
  bucket but not the address's own, so guesses at one account stay bounded —
  ten a minute plus ten per address it has live sessions from. A new address
  still answers to the email bucket.
- The client address is `X-Forwarded-For`'s last entry — the one the
  trusted proxy appended; anything before it is whatever the client sent —
  or the header `WEB_CLIENT_IP_HEADER` names (`cf-connecting-ip` behind
  Cloudflare).
- The sign-in error never says which of email and password was wrong, and an
  unknown email costs the same scrypt as a wrong password.

### Requests from strangers, with approval

`WEB_SIGNUPS=true` (accounts mode only) adds `/signup`, where anyone can ask
for an account — name, email, an optional note, and a box confirming they
read the privacy policy. **Nothing exists for them until an administrator
approves**: a request creates no user, no account and no sync token, so no
phone can send anything. In order:

1. The request is stored (`auth.signup_requests`) and the operator gets an
   email (`WEB_ADMIN_EMAIL`, at most 30 a day). The form answers the same
   whether or not the address is known, emails no one but the operator, keeps
   one open request per address, drops a filled-in honeypot, and takes three
   requests an hour per client address. While 500 requests wait, new ones
   are dropped — stored nowhere, emailed to no one — with the same answer,
   and the server log says so once an hour.
2. An administrator opens `/admin` (in the sidebar) and approves or declines.
   Approval creates the person's user and a 7-day invite and emails it to
   them; when email is off, `WEB_PUBLIC_URL` is unset or the send fails, the
   page shows the link once to send by hand. Declining deletes the request
   and sends nothing — one at a time, the ticked ones (**Decline selected**)
   or every one listed (**Decline all shown**). Approved people who have not
   used their invite are listed with **Send a new invite** (the old link
   stops working) and **Remove**. In the database, an hourly TimescaleDB job
   (`auth.prune_signups`) deletes approved requests 30 days after the
   decision, requests nobody decided 30 days after they were made, and an
   approved person with no account and no invite in 30 days.
3. The person chooses a password, signs in on their iPhone and taps **Connect
   this iPhone** on the account page: the viewer mints a sync token for that
   person's own user, shows it once as a pairing code (a button that opens
   PulsHealth on the iPhone, and a QR code for a computer), and keeps only its
   hash. Phones connect to `WEB_INGEST_URL` (ingest's public HTTPS address;
   Compose defaults it to `PULS_PUBLIC_URL`). The account page lists the
   person's iPhones with a **Disconnect** for each.
4. **Delete my account** disables the account, ends its sessions and revokes
   its tokens at once, and tells the operator, who purges the data from
   `/admin`. An administrator can also **Disable** such an account (which
   disconnects its iPhones) and, once disabled, **Purge** everything stored
   for that user, the hourly rollups included, and blank the names of
   devices and apps no one else's records use. An account whose owner asked
   to be deleted cannot be enabled again. No administrator's account — your
   own included — can be disabled or enabled here; manage those from the
   server. Purge runs with a 30-minute
   timeout of its own, since it unpacks the compressed history the user's
   rows share with others; if the page times out first, it carries on.

All of that applies only to **self-service** users: those an approved request
created, recorded in `auth.self_service_users`. The operator's household —
the default user, phones paired with `make issue-device`, accounts invited
with `make web-invite` — is never given a token, disabled, deleted or purged
through the viewer; those accounts see no **Connect this iPhone** or **Delete
my account**, and `/admin` shows them without buttons. Manage them from the
server.

The privileged steps — creating a user, minting or revoking a token,
declining, disabling, deleting, purging — are `SECURITY DEFINER` functions in
schema `auth` (`server/db/migrations/016_web_signups.sql`, replaced or added
to by `018_web_accounts_hardening.sql`). `web_app` may run exactly
those and still cannot write `users`, `device_tokens` or
`auth.self_service_users` itself. Each takes the caller's session as
`auth.sessions` stores it (the cookie's SHA-256; the plaintext never reaches
the database) and acts for that account: a token only for the signed-in
person's own user, the administrator's steps only for an administrator. That
scopes normal use, but it is not a barrier against SQL run as `web_app`,
which writes `auth.sessions` to sign people in and so can forge a session.
The barrier is the self-service list: such SQL could at worst give a
self-service user a token, or disable or purge one. It still cannot give a
household user a sync token, revoke their phones' tokens or delete anything
they stored. It can change their *viewer* accounts, as it always could,
since it writes `auth.accounts` to sign people in.

**Email** goes through Amazon SES's API (`lib/email.ts`, signed by hand, no
dependency): `WEB_SES_ACCESS_KEY_ID`, `WEB_SES_SECRET_ACCESS_KEY`,
`WEB_SES_REGION`, and `WEB_MAIL_FROM` on a domain SES has verified. Give that
IAM user nothing but `ses:SendEmail` on the domain's identity, conditioned on
`ses:FromAddress` being that one address. Without these settings nothing is
emailed and `/admin` is the only place requests appear.

**Before you approve someone you do not know,** know what it makes you:
someone who holds a stranger's health records. In the US the FTC Health
Breach Notification Rule likely applies. Say what you do with their data in
your privacy policy; the project's own covers the maintainer's instance only,
and the app's App Store privacy answer declares the data collected there
(`docs/appstore/listing.md`).

The code: `proxy.ts` and `lib/accounts/` (policy, request facts, sessions,
passwords, throttling, the account store), the routes under `app/login`,
`app/invite`, `app/account` and `app/api/auth`, and `scripts/invite.mjs`.
`lib/accounts.integration.test.ts`, `lib/signups.integration.test.ts` and
`lib/webapp.integration.test.ts` run the whole flow and the role's isolation
against a real database in CI: `npm run test:integration` runs every
`*.integration.test.ts` with `WEB_APP_DATABASE_URL` and `ADMIN_DATABASE_URL`
set. Without them the suites skip, unless `PULS_CI_REQUIRE_INTEGRATION=1` (or
`PULS_WEB_INTEGRATION=1`) makes that a failure.

## What's here

| Route | View |
|---|---|
| `/` | **Today** — activity rings from today's local `HKActivitySummary`; falls back to today's quantity totals when today's summary is missing, plus headline metrics, recent workouts, and categories |
| `/category/[group]` | All metrics in an Apple-Health group (Activity, Heart, Sleep, …) as live cards |
| `/type/[id]` | **Metric detail** — interactive trend chart with D/7D/30D/90D/6M/Y/2Y/5Y/ALL ranges (see "The trend chart" below), min–max band for instantaneous metrics, bar series for cumulative ones, range stats; hover, tap or arrow keys read a bucket, wheel/pinch zoom and drag pan |
| `/data` | **Catalog** — quantity, category, and workout types with supported viewer routes, grouped with per-user sample counts and last-seen |
| `/workouts` | Latest 120 sessions with duration / energy / distance totals |
| `/workouts/[uuid]` | **Workout detail** — route map, heart rate and zones, splits, intra-workout streams, elevation, sub-activities |
| `/settings` | Whose data is on screen and its profile (age, sex, heart-rate figures behind the zones); display preferences, saved in this browser |
| `/account` | Accounts mode: connect or disconnect your iPhones, change the password, the browsers signed in, delete the account |
| `/admin` | Accounts mode, administrators: approve or decline access requests (one, the ticked ones, or all shown); disable non-administrator accounts, purge a disabled user's data |
| `/signup`, `/login`, `/invite/[token]` | Accounts mode: ask for access (with `WEB_SIGNUPS`), sign in, accept an invite |

## Architecture

```
web/
├── app/                 # routes (server components query Postgres directly)
├── components/          # Sidebar, ActivityRings, TrendChart, Sparkline, MetricCard …
└── lib/
    ├── catalog.generated.ts  # GENERATED from ../docs/protocol/catalog.json (npm run gen:catalog)
    ├── catalog.ts       # the web catalog: generated core + web-only overlay, GROUPS, lookups
    ├── queries.ts       # the single data API (user id as first argument), re-exported from data/
    ├── data/            # source.ts (live/demo/error, liveRead), series, stats, rings, workouts, users
    ├── uuid.ts          # isUuid(): the one UUID check (canonical form, as ingest accepts)
    ├── viewer.ts        # which user this request shows: the session's (accounts), else puls-user cookie / PULS_USER_ID
    ├── mode.ts          # open / basic / accounts, from the environment
    ├── accounts/        # accounts mode: policy, sessions, passwords, throttling, account store
    ├── securityHeaders.ts # per-request CSP (nonce) and the static hardening headers
    ├── db.ts            # pg pool; scoped() runs health reads as one user (server-only)
    ├── demo.ts          # deterministic synthetic data
    ├── metrics.ts       # cumulative-vs-instantaneous classification, time ranges
    ├── chart.ts         # SVG path / scale helpers
    ├── colors.ts        # per-group accent palette
    └── format.ts        # value / unit / time formatting
```

**How data is read.** Like Grafana, the viewer queries TimescaleDB directly
rather than going through the product API: `quantity_samples` /
`category_samples` / `workouts` joined to `sample_types`, bucketed with
`time_bucket()`. Every health-data read runs in one read-only transaction
scoped to the user being shown (`scoped()` in `lib/db.ts`: the session's user
in accounts mode, else the `puls-user` cookie or `PULS_USER_ID` — see
"Choosing a user"), with calendar
boundaries in `PULS_TIME_ZONE`. Sleep and mindful sessions are durations, Stand
Hours count only stood records, and other categories are occurrence counts.
Cumulative raw samples total each source separately and choose the highest source
per bucket to avoid overlapping phone/Watch double counts; when the viewer's
`PULS_TIME_ZONE` equals the database's `puls_time_zone()`, daily canonical values
come from `metric_daily`; otherwise they come from raw local buckets. Today's
totals always use current raw local-day values, so the live headline does not
depend on aggregate refresh or bucket-settlement timing.
Instantaneous types average with a min–max band. Activity rings require the selected
user's summary for the actual current local date.

**The catalog is generated, not mirrored.** `lib/catalog.generated.ts` is
rendered by `npm run gen:catalog` (`scripts/gen-catalog.mjs`, no dependencies)
from the published type vocabulary `../docs/protocol/catalog.json`, which the
PulsHealthSync package tests render from the Swift `HealthTypeCatalog` — the
one place identifiers, kinds, canonical units, groups and display names are
defined (see `../docs/protocol/catalog.md`). `lib/catalog.ts` merges that core
with a web-only overlay (name overrides) and exposes `CATALOG`, `GROUPS`,
`GROUP_LABELS` and the lookups. To add a type, add it to the Swift catalog,
regenerate the JSON there, run `npm run gen:catalog` here and commit both
generated files; never edit them by hand. `npm run check:catalog` (run in CI)
fails when the generated file is stale, and `lib/catalog.test.ts` pins the
merged catalog to the JSON.

## The trend chart

**Ranges.** The selector (and `?range=`) offers D, 7D, 30D, 90D, 6M, Y, 2Y, 5Y
and ALL; `lib/metrics.ts` holds the table. The old `W` and `M` links still
open 7D and 30D. Each range fixes its bucket — hourly for D, daily through 90D,
weekly for 6M and Y, two-weekly for 2Y, calendar months for 5Y — and ALL starts
at the type's earliest sample (from the per-user stats the page loads anyway)
and sizes its bucket to that span, from days up to calendar quarters, so a
chart stays at roughly 30–90 points. Every bucket boundary is a local one in
`PULS_TIME_ZONE`, and day-or-coarser buckets of a covered type read
`metric_daily` (the hourly `quantity_rollups` underneath it) rather than raw
samples; the rest read `quantity_samples`, as before, so a 5Y or ALL chart of
a type without a daily aggregate is a scan of that type's whole history.

`components/TrendChart.tsx` is hand-drawn SVG driven by pointer events — no
chart library, in keeping with the viewer's dependency budget. On a metric page:

| Input | Effect |
|---|---|
| Hover (mouse, pen) | Crosshair and tooltip for the nearest bucket: its timestamp (hour, day, or the week it covers), value and unit, plus the min–max range when the bucket has one |
| Click / tap | Pins that bucket; the tooltip stays until another is picked, or Escape. Tapping again unpins |
| Wheel, trackpad pinch, two-finger pinch | Zooms the time window about the pointer, never narrower than five buckets or wider than the data |
| Horizontal drag, horizontal wheel | Pans the window while zoomed, stopping at the data's edges |
| **Reset** (shown while zoomed) | Back to the full selected range |
| Arrow keys, Home/End, PageUp/PageDown, `+`/`-`, Escape, `0` | Keyboard equivalents once the chart has focus (Tab reaches it): move the selection, zoom about it, clear the selection, then the zoom |

Changing the range always starts from the full new range with
nothing pinned — the zoom never changes which range button is selected. The
row above the chart is an `aria-live` readout of the active bucket (or the
visible window while zoomed), so the value is never hover-only. The SVG uses
`touch-action: pan-y`: one finger scrolls the page as usual, and only a
horizontal drag on a zoomed chart pans. The y axis follows the visible window.
The time arithmetic (clamp, zoom, pan, nearest bucket, wheel normalisation) is
`lib/chartDomain.ts`, pure and covered by `lib/chartDomain.test.ts`.

## Map tiles

The workout route map (`lib/mapStyles.ts`) draws its basemap from free public
tile endpoints that need no API key: Esri's Dark Gray and Light Gray Canvas
(`server.arcgisonline.com` — the dark and light styles, and so the `auto`
default), OpenStreetMap (`tile.openstreetmap.org`), Esri World Imagery, and
OpenTopoMap. The Canvas tiles stop at zoom 16; Leaflet scales those up for the
three levels past it. CARTO's basemaps used to supply the dark, light and
Voyager styles, but since September 2026 they answer every keyless request
with an "API KEY REQUIRED" tile, so they are gone: Voyager had no keyless
equivalent, and a browser that had picked it falls back to Auto. Each style
carries the attribution its operator requires, set in `mapStyles.ts` and
rendered by Leaflet's attribution control — that is a licence condition, not
decoration. These are other people's servers, though, offered under usage
policies written for modest, non-redistributed use (the
[OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/),
Esri's ArcGIS Online terms). One person's viewer sits
well inside them; a public or heavily-trafficked deployment does not, and should
point at its own tile server or a paid provider rather than lean on the free
endpoints.

## Notes

- Read-only by design — this is a viewer; it never writes to the health store.
- Pages render dynamically. Data-source and catalog-stat checks use short in-process
  TTL caches to avoid repeated database work.
- Theme (dark/light) is set before paint and persisted to `localStorage`.
