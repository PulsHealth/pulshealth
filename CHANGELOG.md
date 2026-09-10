# Changelog

What changed in each release of the **server stack** — the four images
`ghcr.io/pulshealth/{ingest,api,mcp,web}`, which share one version that
`PULS_VERSION` in `.env` selects. Upgrading is: bump it, then `make pull up`.

Two things are versioned separately and are not in this file:

- **The iOS app**, which ships on its own schedule through the App Store. Its
  record is [`docs/appstore/README.md`](docs/appstore/README.md) § Release
  record.
- **The Puls Sync Protocol**, whose `schemaVersion` (and `X-Puls-Protocol`
  header) moves only for a change a v1 receiver would reject. A server release
  that adds an optional field or a new read endpoint keeps the protocol number
  where it is; [`docs/protocol/README.md`](docs/protocol/README.md) is the
  contract.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases are [semver](https://semver.org/spec/v2.0.0.html) over the stack:
a major for a change that needs operator action (a breaking config or schema
change), a minor for features, a patch for fixes. While the stack is on 0.x
that promise is weaker by convention — a minor may carry a change that needs
operator action, and when it does this file says so at the top of the entry.

## Unreleased

Nothing since 0.1.0.

## [0.1.0] - 2026-09-09

The first tagged release, and the one that first publishes
`ghcr.io/pulshealth/{ingest,api,mcp,web}` — before it, a compose install had
nothing to pull and had to build from the checkout. Everything below shipped
together; there is no earlier release to diff against.

### Added

- **The Puls Sync Protocol, v1.** One gzipped NDJSON `POST` plus optional read
  endpoints, specified in `docs/protocol/` with JSON Schemas, a fixture corpus
  with expected outcomes, an offline schema checker (`tools/protocol-check`)
  and a Python reference receiver. The receiver's smoke test doubles as a
  conformance runner against any implementation:
  `smoke_test.py --url <url> --token <token>`.
- **The reference backend.** Go ingest and product API over PostgreSQL 17 /
  TimescaleDB, with Grafana dashboards for the data and for ingest health.
  Ingest is idempotent per sample UUID, upserts aggregates and activity rings,
  and connects as a scoped DML-only role rather than the superuser.
- **Schema migrations that apply themselves.** The `migrate` service runs
  before every app service on `docker compose up -d`, records each file in
  `schema_migrations` with a checksum, refuses an edited or missing applied
  file, and requires an explicit `baseline` for a database that predates it.
- **A one-command quickstart.** `scripts/bootstrap.sh` generates the secrets,
  starts the stack and prints the pairing QR; `make` wraps the rest. `--lan`
  trades TLS for a phone on the same Wi-Fi, on request only.
- **Read-only MCP server** (`server/mcp`), 11 tools over the product API in
  stdio and streamable-HTTP modes, so Claude Desktop, Claude Code, Cursor and
  ChatGPT can answer questions from the data. It never touches Postgres.
- **Export.** `GET /v1/export` streams CSV or JSONL; `tools/puls-export` is a
  dependency-free CLI over it.
- **Product API endpoints an analyst asks for first:** daily sleep, bounded raw
  samples, workout series, state of mind, activity rings, daily metrics that
  resolve the iPhone/Watch double-count.
- **One type vocabulary.** `docs/protocol/catalog.json` is rendered from the
  Swift `HealthTypeCatalog`, and the web catalog is generated from the JSON, so
  the two published lists cannot drift.
- **Self-hosting safety rails.** Auth-failure rate limiting on both ingest and
  the product API (failed attempts only, never successful ones), a `/healthz`
  on each that answers from a two-second cache rather than the pool, an
  optional password on the web viewer, loopback binds by default, and an
  opt-in backup service with a documented restore drill.
- **Open-source hygiene.** Apache-2.0 with `NOTICE` and `TRADEMARK.md`,
  `SECURITY.md`, `CONTRIBUTING.md` with DCO sign-off, a code of conduct, issue
  and PR templates, `AGENTS.md`, `llms.txt`, and a CI gate that fails on
  owner-specific content in tracked files.
