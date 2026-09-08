# Security policy

PulsHealth moves personal health data from an iPhone to a server the user
runs. Security problems in it matter more than in most hobby projects, so
please report them privately and give the maintainer a chance to fix them
before anything is public.

## Supported versions

The project is **pre-release**. There are no tagged releases yet; the `main`
branch is the only supported line, and fixes land there. Once tagged releases
exist, this section will name the supported ones.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:

**https://github.com/PulsHealth/pulshealth/security/advisories/new**

That is the only reporting channel. Do not open a public issue, pull request,
or discussion for a security problem, and do not email individual maintainers.

A useful report includes:

- which component is affected (iOS app, `PulsHealthSync` package, ingest
  server, product API, web viewer, Compose stack, database schema);
- the commit or version you tested;
- steps or a proof of concept that reproduces the problem;
- what an attacker gains (data read, data written or deleted, denial of
  service, code execution, and so on);
- whether you believe it is already being exploited.

## What to expect

This is a volunteer-maintained project.

- You should get an acknowledgement within **7 days**.
- You should get an initial assessment (accepted, needs more information, or
  not a vulnerability) within **14 days**.
- Accepted reports are fixed on `main` and published as a GitHub Security
  Advisory that credits you, unless you ask not to be named. Until a release
  process exists, "fixed" means the commit is on `main` and the advisory says
  which commit to update to.
- Please allow up to **90 days** before disclosing publicly. If a fix is
  taking longer, the maintainer will say so rather than go quiet.

## Scope

Everything in this repository is in scope, in particular:

- **Ingest server** (`server/ingest`): the only component designed to face the
  network. Authentication bypass, parsing crashes, decompression or memory
  exhaustion, SQL injection, and anything that lets one bearer token read or
  modify data outside its intended reach.
- **Product API** (`server/api`): token handling, data exposure beyond the
  read-only role it is meant to have.
- **iOS app and `PulsHealthSync`**: handling of the server URL and bearer
  token, health data written outside the app container, data sent anywhere
  other than the configured server.
- **Compose stack and schema** (`server/docker-compose.yml`, `server/db/migrations`):
  defaults that expose a service or credential more widely than documented.
- **Web viewer** (`web/`): only as deployed the documented way — bound to
  loopback or a private interface. See the note below.

Out of scope:

- Vulnerabilities in upstream images and dependencies (PostgreSQL,
  TimescaleDB, Grafana, Next.js, Go modules). Report those upstream; a report
  here is welcome if the project pins a version with a known fix available.
- Deployments that diverge from the documentation, such as publishing the web
  viewer, Grafana, or the database port on a public interface.
- Attacks that require an unlocked phone in hand, or a compromised server host.
- HealthKit behaviour (delivery latency, permission-sheet quirks). Those are
  bugs, not vulnerabilities; use the issue tracker.

## Things to know about the current design

These are documented properties of the pre-release design, tracked in
`docs/open-source-plan.md`. They are not vulnerabilities to report; they are
context for judging what is.

- **Self-hosted.** No PulsHealth service ever receives your data. Where your
  server runs, how it is exposed, and who can reach it are your decisions.
- **One bearer token.** The ingest server accepts a single static
  `PULS_TOKEN`. Anyone who holds it can upload, delete, and (via the
  reconciliation endpoints) enumerate samples. The `X-User-ID` header selects
  the user without further authentication. Per-device tokens bound to a user
  are on the roadmap.
- **The token lives on the phone.** Today it is stored in the app's sync-state
  file, not the Keychain. Moving it to the Keychain with file protection is a
  pre-1.0 requirement.
- **TLS is yours to provide.** Every service binds to loopback by default. The
  phone must reach the ingest port over HTTPS through a TLS-terminating
  reverse proxy or a VPN; the token is only a second layer.
- **The web viewer is unauthenticated by design.** It is a read-only page over
  the health database with no login. It must never be exposed on a public
  interface. Its bind address is the access control; keep `WEB_BIND_ADDR` on
  loopback or a private network.
- **Health data at rest.** The database holds identifiable data (name, email,
  date of birth, sex) alongside samples. Ingest connects as the Postgres
  superuser unless you opt in to the scoped `ingest` role described in
  `server/README.md`. There are no backups unless you add them.
