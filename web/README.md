# Puls Web

A sleek, Apple-Health-inspired web frontend for the self-hosted Puls health store.
Built with **Next.js (App Router) + TypeScript**, it reads directly from the same
**TimescaleDB** that Grafana uses, and renders bespoke hand-built SVG charts —
activity rings, range-banded trend lines, and bar series — with a Vercel-clean
monochrome shell and per-category accent colors.

> **Local demo mode.** Outside production, an unset or unreachable `DATABASE_URL`
> serves generated demo data. Production never fabricates health data: database
> errors produce an explicit unavailable state and empty views.

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
# Local docker stack (../server)
cd ../server && docker compose up -d db
# then in web/.env:
DATABASE_URL="postgres://postgres:YOUR_PASSWORD@localhost:5432/postgres?sslmode=disable"

# A remote stack whose Postgres port is bound to loopback: open an SSH tunnel
# and connect through it as the read-only `grafana` role.
ssh -N -L 15432:127.0.0.1:5432 <user>@<host>
DATABASE_URL="postgres://grafana:GRAFANA_DB_PASSWORD@127.0.0.1:15432/postgres?sslmode=disable"
```

Inside the compose stack the `web` service gets `DATABASE_URL` built from
`GRAFANA_DB_PASSWORD` automatically (see `../server/docker-compose.yml`).

`PULS_USER_ID` selects the one user shown by this read-only viewer; it defaults to
the seeded app user. `PULS_TIME_ZONE` controls Today, greetings, chart buckets,
and day boundaries; it defaults to `UTC` and must match the server stack's
`PULS_TIME_ZONE` (the database exposes its own as `puls_time_zone()`; on a
mismatch the viewer logs a warning and stops using `metric_daily`). The status
dot shows **Live data** (green), **Demo data** (amber), or **Database unavailable**.

## Access control

There is none. The viewer has no login and no per-request authentication: whoever
can reach the port can read every health record of the configured user. Keep it
on a private bind address (the compose stack binds it to `WEB_BIND_ADDR`, default
`127.0.0.1`), reach it over an SSH tunnel or a private overlay network, or put
it behind a reverse proxy that authenticates. Never expose it directly to the
internet.

## What's here

| Route | View |
|---|---|
| `/` | **Today** — activity rings from today's local `HKActivitySummary`; falls back to today's quantity totals when today's summary is missing, plus headline metrics, recent workouts, and categories |
| `/category/[group]` | All metrics in an Apple-Health group (Activity, Heart, Sleep, …) as live cards |
| `/type/[id]` | **Metric detail** — interactive trend chart with D/W/M/6M/Y ranges, min–max band for instantaneous metrics, bar series for cumulative ones, range stats |
| `/data` | **Catalog** — quantity, category, and workout types with supported viewer routes, grouped with per-user sample counts and last-seen |
| `/workouts` | Latest 120 sessions with duration / energy / distance totals |

## Architecture

```
web/
├── app/                 # routes (server components query Postgres directly)
├── components/          # Sidebar, ActivityRings, TrendChart, Sparkline, MetricCard …
└── lib/
    ├── catalog.generated.ts  # GENERATED from ../docs/protocol/catalog.json (npm run gen:catalog)
    ├── catalog.ts       # the web catalog: generated core + web-only overlay, GROUPS, lookups
    ├── queries.ts       # the single per-user data API; local demo fallback
    ├── db.ts            # pg pool (server-only)
    ├── demo.ts          # deterministic synthetic data
    ├── metrics.ts       # cumulative-vs-instantaneous classification, time ranges
    ├── chart.ts         # SVG path / scale helpers
    ├── colors.ts        # per-group accent palette
    └── format.ts        # value / unit / time formatting
```

**How data is read.** The Go ingest API (`../server/ingest`) is write-mostly — its
only GETs return type counts and reconciliation digests, not time series. So, like
Grafana, this app queries TimescaleDB directly: `quantity_samples` /
`category_samples` / `workouts` joined to `sample_types`, bucketed with
`time_bucket()`. Every health-data read is scoped to `PULS_USER_ID`, with calendar
boundaries in `PULS_TIME_ZONE`. Sleep and mindful sessions are durations, Stand
Hours count only stood records, and other categories are occurrence counts.
Cumulative raw samples total each source separately and choose the highest source
per bucket to avoid overlapping phone/Watch double counts; when the viewer's
`PULS_TIME_ZONE` equals the database's `puls_time_zone()`, daily canonical values
come from `metric_daily` (any other zone, or an older database without the
function, uses raw local buckets). Today totals always use current raw local-day values,
so the live headline does not depend on aggregate refresh or bucket-settlement timing.
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

## Notes

- Read-only by design — this is a viewer; it never writes to the health store.
- Pages render dynamically. Data-source and catalog-stat checks use short in-process
  TTL caches to avoid repeated database work.
- Theme (dark/light) is set before paint and persisted to `localStorage`.
