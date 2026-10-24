# Set up your PulsHealth server

Run a database on your own computer, NAS or cloud server, pair your iPhone,
and check that your Apple Health data arrives. The stack includes the database,
web dashboard, Grafana, a read-only API and an AI connection through MCP.

You can follow this guide yourself or give it to a coding assistant with
terminal access to your server. A chat assistant without that access can explain
the steps, but cannot run or verify them for you. The backend is pre-release;
you are responsible for keeping the host running, access control and backups.

## Ask AI to help

Copy this prompt into your coding assistant:

```text
Help me set up PulsHealth on my server. Read https://pulshealth.com/llms.txt and https://pulshealth.com/docs/setup/ first. Check my machine, network and existing installation, then follow the guide. Preserve existing data and keep secrets out of chat. Help me pair my iPhone and verify that synced data arrived.
```

The assistant should establish the host OS, whether Docker works, your reporting
time zone, and how the phone will reach the host. If PulsHealth already exists,
inspect that installation and follow [upgrading](../server/README.md#deploying-and-upgrading)
instead of creating another stack. Compose uses the project name `pulshealth`;
a second checkout on the same Docker host is not an isolated installation.

## 1. Prepare the host

You need:

- A Linux or macOS host that stays on, with persistent disk space for your data.
  A NAS must support the Docker Compose stack and a shell for these commands.
- Git, Bash, Docker with Compose v2, `openssl` and `curl`. Optional `make`
  provides shortcuts used in the operations guide.
- The [PulsHealth app](https://apps.apple.com/us/app/pulshealth/id6757657354)
  on your iPhone or iPad, with Apple Health data available to read.
- Free host ports: `8080` (phone uploads), `8081` (read API), `8082` (MCP),
  `3000` (Grafana), `3001` (dashboard) and `5432` (Postgres).

Check Docker before continuing:

```bash
docker compose version
docker info
```

Choose your usual reporting time zone, such as `Europe/Berlin`. This is an IANA
zone name, not an abbreviation such as `CET`. It supplies the default calendar
for server reports; phone-recorded daily aggregates retain their recorded dates.

## 2. Start the stack

For a new installation, run these commands **on the server**:

```bash
git clone https://github.com/PulsHealth/pulshealth.git
cd pulshealth
git rev-parse HEAD
scripts/bootstrap.sh --build --time-zone Europe/Berlin
```

Replace `Europe/Berlin` with your zone. This builds the four application images
from the checkout, keeping the code and database migrations together. The first
build downloads dependencies and can take several minutes. No local Go, Node.js
or Xcode installation is needed.

Keep the printed Git revision with your setup notes. The script generates `server/.env`, starts the services, applies the schema,
and checks ingest and its authentication. It prints credentials locally: keep
that output and the pairing QR code private. An assistant should not repeat
passwords, tokens or pairing links in chat.

Initially, every port listens only on the server's loopback address. A pairing
URL of `(none yet)` is expected until the next step. The web dashboard already
works at `http://localhost:3001` **in a browser on that host**.

**Using published images instead:** select a published backend release and
check out its exact `vX.Y.Z` tag before the first bootstrap, then omit `--build`.
Use that release's README and confirm all four image tags are available.
Bootstrap pins `PULS_VERSION=X.Y.Z` only when creating a fresh `.env` at a
release tag. Do not combine `main` migrations with floating `latest` images.
See [images and versions](../server/README.md#images-and-versions).

## 3. Give the phone a reachable address

Choose one route. `localhost` on the phone means the phone itself, not your
server. Setting `--url` records a pairing address; it does not create DNS,
certificates, a VPN, a firewall rule or a reverse proxy.

### Private HTTPS or an existing HTTPS proxy

For regular use, put an HTTPS proxy in front of `http://127.0.0.1:8080`.
A private VPN with HTTPS, such as Tailscale Serve, keeps the endpoint accessible
only to your devices. A public HTTPS proxy also works; it must preserve the
`Authorization` header and accept the app's uploads without a browser login.

Once the HTTPS route works, record its base URL (no `/v1/batches` suffix):

```bash
scripts/bootstrap.sh --build --url https://health.example.com
```

Replace the example with your real URL. Leave `INGEST_BIND_ADDR=127.0.0.1` for
a proxy running on the host. A containerized proxy needs a route to the Compose
`ingest:8080` service instead of its own `localhost`.
[Exposing the server](../server/README.md#exposing-the-server) has examples.
Private VPN URLs require the phone to be connected to that VPN; they are not
reachable by a cloud AI connector unless you separately configure access.

### Same trusted home network

For a local trial without HTTPS:

```bash
scripts/bootstrap.sh --build --lan
```

Connect the phone to the same network and use the printed `http://<LAN IP>:8080`
address. This sends health data and credentials without TLS and binds ingest to
**all host interfaces**. Use it only on a trusted private network, allow access
only from that network, and do not forward port 8080 from your router. Do not
use this option on a publicly reachable cloud host.

If the detected address is wrong, use the host's actual private LAN address.
If moving from LAN to HTTPS later, set `INGEST_BIND_ADDR=127.0.0.1` in
`server/.env` before running bootstrap with `--url`; `--url` alone does not undo
`--lan`. An existing `PULS_PUBLIC_URL` takes precedence over LAN detection.

## 4. Pair the app and choose what to sync

1. Open PulsHealth, complete the first-run Health permission step, then open
   **Sync → Connect Your Server** (or **Sync → Database** if already configured).
2. Use **Scan Pairing Code** or **Paste Pairing Code** with the script's output.
   Alternatively enter the database URL and token; keep the user ID the server
   supplied. Pairing fills the fields and tests the connection. Use **Test
   Connection** again after editing them.
3. Tap **Add Database**, then review the types and history on the Sync screen.
   **Raw Samples → Edit** selects individual readings; **Aggregates → Edit**
   selects summaries. Include daily aggregates for phone-computed totals and
   averages. Server daily results can also use raw-data fallbacks; the
   [database guide](database-guide.md) explains the differences. **Match Raw
   Samples** adds daily defaults for eligible raw types.
4. Tap **Apply**, review the initial-sync guidance, then **Apply & Start Sync**.
   For an existing saved destination, the Database screen uses **Save & Apply**.
   Earlier app versions may also use that label during first setup.

Keep the phone unlocked and PulsHealth open for the first sync, preferably
plugged in for a large history. Apple Health permissions and your app plan
limit what can be read; a connection does not grant access to every type or all
history. Background sync resumes as iOS allows, rather than on a guaranteed
schedule.

To display the shared pairing code again, run this locally on the host:

```bash
scripts/bootstrap.sh --print-pairing
```

For separate, revocable phone credentials, use
[`--issue-device`](../server/README.md#tokens). Multiple people also need
separate user IDs and appropriate viewer access; the default single-password
viewer can show every user on the server.

## 5. Verify the whole path

From the repository root on the server:

```bash
docker compose -f server/docker-compose.yml ps --all
docker compose -f server/docker-compose.yml logs --tail=50 migrate
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8081/healthz
curl -fsS http://127.0.0.1:3001/api/healthz
```

The one-shot `migrate` service should exit successfully; the long-running
services should be healthy where they have health checks. Both Go probes should
report `"ok":true` and `"db":true`. These checks prove server readiness, not a
successful phone sync.

Finish by checking all three:

- **Phone:** Test Connection succeeds over its actual network connection.
- **Upload:** the Sync screen shows a completed upload without an error. Use
  **Sync Now** if needed while the phone is unlocked.
- **Read-back:** the dashboard shows a recent measurement or workout you chose
  to sync, for the correct user and date. Confirm a daily chart too if you
  enabled daily aggregates. An empty database or demo dashboard is not proof.

Open `http://localhost:3001` on the host and use any username with the generated
`WEB_AUTH_PASSWORD` printed by bootstrap. For a remote server, run an SSH tunnel
**on your computer**, replacing `user@server` with your SSH destination:

```bash
ssh -N -L 3001:127.0.0.1:3001 user@server
```

Then open `http://localhost:3001` on your computer. Port 3001 must be free there.
For permanent browser access, configure a separate HTTPS route to the viewer;
the phone's ingest URL is not the dashboard. See [web viewer access](../web/README.md#access-control).

## 6. Keep it running

Backups are **off by default**. Set `PULS_BACKUP_DIR` in `server/.env` to protected
storage outside the database's disk, then enable the scheduler:

```bash
docker compose -f server/docker-compose.yml --profile backup up -d backup
```

[Backup and restore](../server/README.md#backup-restore) explains immediate
dumps, retention and restoring a copy on a scratch stack. A successful dump is
not a tested restore. Keep `server/.env` separately in secure storage; database
dumps do not replace the host configuration.

For source-built installs, use `scripts/bootstrap.sh --build` or `make dev-up`
when starting updated application code. A plain `docker compose up -d` or
`make up` selects published images instead. Take a backup and read
[upgrading](../server/README.md#deploying-and-upgrading) before moving revisions.
Do not delete `.env`, reset the database or run `docker compose down -v` to fix a
connection problem.

Once phone sync and read-back work, [connect an AI assistant](ai.md) if wanted.
That is a separate step: the setup assistant does not need health-data access
just to install the server.

## If something fails

| Symptom | Check next |
|---|---|
| Docker command fails | Start Docker and confirm this shell can run `docker info` and Compose v2. |
| A port is already allocated | Identify the existing service or PulsHealth installation before changing ports or starting another checkout. |
| Build, startup or migration fails | Read the failing service's logs. Preserve `.env` and volumes; do not reset or baseline an unknown schema. |
| No pairing URL or QR code | Complete step 3. Missing QR rendering still permits manual entry or the printed pairing payload. |
| Phone cannot connect | Check Wi-Fi/VPN, hostname, certificate, firewall and proxy. Do not use the server's `localhost` on the phone. |
| HTTP 401 or 403 | Use the ingest token, not `PULS_API_TOKEN` or `PULS_MCP_TOKEN`; for a device token, the paired user ID must match. |
| Connection works but no data arrives | Apply the setup, select a type with recorded data, grant Health access, unlock the phone and tap Sync Now. Check plan/history limits and the Sync activity log. |
| Raw readings arrive but daily results are empty | Check the user and dates. Enable a daily total or average for that type and Apply; API daily results need supported aggregate-series metadata even when falling back to raw data. |
| Browser cannot open port 3001 remotely | It binds to loopback by default. Use the SSH tunnel or configure viewer HTTPS; `--lan` only exposes ingest. |

For server diagnostics, run
`docker compose -f server/docker-compose.yml logs --tail=100 ingest api web`.
Review output locally and redact personal data before sharing it. An AI
assistant should finish with the installed revision, reachable URLs, checks
actually passed, backup status, and any phone steps still awaiting you.
