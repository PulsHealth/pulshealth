# PulsHealth for Home Assistant

Use the Apple Health data already synced by PulsHealth in Home Assistant
dashboards and automations. The integration polls the existing read-only
product API; it needs no changes to the iPhone app, database, or sync protocol.

The integration bundles the same blue PulsHealth mark used by the website and
iPhone app. Home Assistant serves the included `brand/icon.png` (256 px) and
`brand/icon@2x.png` (512 px) locally, with logo and dark-mode fallbacks. The
512 px image is copied from `site/public/logo.png`; resize that asset for the
256 px image when updating the shared branding.

## What you can do

- Show today's steps, walking/running distance, active energy, and Move,
  Exercise and Stand ring values and goals.
- Celebrate closing all three rings, or show progress toward exercise goals.
- Display the latest sleep session from the last seven days and the latest
  completed workout's end time, duration, distance, and energy.
- Monitor the last received sync so you can recognize stale phone data.

These are **synced summaries**, not a live Watch feed. Polling defaults to five
minutes, and the iPhone must have synced before Home Assistant can see a change.
Apple's locked-device/background scheduling restrictions still apply. A workout
start/stop automation needs an Apple Shortcuts trigger calling Home Assistant;
the completed-workout API cannot tell whether you are currently exercising.

## Requirements and authentication

- Home Assistant **2026.10.0 or later** (tested against 2026.10.0).
- A PulsHealth account at **https://app.pulshealth.com**, with data synced from
  the iPhone app. Daily step, distance, and active-energy sensors require daily
  aggregates; raw samples alone are insufficient.

Choose **Sign in to PulsHealth** during setup. Home Assistant registers its own
public OAuth client, opens PulsHealth sign-in and consent in your browser, and
uses PKCE S256 to exchange a single-use code. You authorize access to your own
account. No server token, developer credentials, VPN, or Tailscale is required.
The browser returns through `https://my.home-assistant.io/redirect/oauth`; this
redirect service sends you back to your HA instance. HA makes outbound HTTPS
requests, so it does not need a publicly reachable inbound port.

Access tokens last 30 minutes. Home Assistant refreshes them automatically;
refresh tokens rotate on every use and expire after 60 inactive days. Revoke the
Home Assistant connection on PulsHealth's account page to stop access. The
public API checks the exact grant and active account on every read, so revocation
and account disablement take effect immediately. Tokens are stored in HA's
config entry; secure your HA configuration and backups.

### Self-hosted deployments

Choose **Self-hosted product API** for the existing `/v1` API with a deployment
`PULS_API_TOKEN`. It must be reachable from HA itself, preferably through HTTPS.
The viewer, ingest, and MCP endpoints are different services. With multi-user
reads enabled, this owner credential can read other accounts; account selection
is not a narrower credential. Never distribute the deployment token to hosted
customers. Self-hosted accounts-mode servers with OAuth enabled can instead use
**Sign in to PulsHealth** and their public viewer URL.

### Server configuration

The public health gateway lives at `<WEB_PUBLIC_URL>/api/health/v1/…`, behind the
existing viewer HTTPS ingress. It is enabled only in accounts mode with valid
`WEB_PUBLIC_URL`, `PULS_MCP_URL`, and `PULS_MCP_OAUTH_SECRET`. The Compose web service
also receives `PULS_API_URL=http://api:8081` and `PULS_API_TOKEN` internally. The
underlying owner API keeps its loopback binding and token.

Only GET users, catalog/types, metrics/daily, activity/summary, sleep/daily, and
workouts are exposed. Every request requires an API-audience bearer token; MCP
tokens and login cookies cannot authorize reads. The API pins the subject from
the verified token, filters user discovery to that person, rejects account
switching, and bounds daily windows to 31 days and workouts to 50. No write,
export, routes, raw samples, or account administration endpoint is exposed.

## Install

### HACS custom repository

The repository has the standard `custom_components/pulshealth` layout.
In HACS, add `PulsHealth/pulshealth` as a custom repository of type
**Integration**, then download PulsHealth and restart Home Assistant.
Choose **main** as the download version: older PulsHealth app/server release tags
predate this component. HACS default-store inclusion is not claimed.

### Manual

Copy the repository's [`custom_components/pulshealth`](../../custom_components/pulshealth)
folder to `<HA config>/custom_components/pulshealth`, then restart Home Assistant.
Do not copy the entire repository or install the test dependencies into HA.

### Configure

1. Go to **Settings → Devices & services → Add integration → PulsHealth**.
2. Choose **Sign in to PulsHealth**, enter a display name, and leave the server
   at `https://app.pulshealth.com`.
3. Sign in and approve Home Assistant's read-only access. Return to HA to finish.
4. Use the integration's options to change polling between 60 and 3600 seconds.

For the self-hosted product API option, enter the API base URL and deployment
read-only token. Leave Account UUID blank to permanently pin the default account,
or enter an account UUID when multi-user reads are enabled.

Each entry belongs to one server and account. Reauthentication must reconnect
that same account. Network errors mark entities unavailable and retry later.

## Values and recording

| Entity suffix (with display name `Fitness`) | Meaning / native unit |
|---|---|
| `sensor.fitness_steps_today` | Daily aggregate step count |
| `sensor.fitness_walking_and_running_distance_today` | Daily distance, m |
| `sensor.fitness_active_energy_today` | Daily aggregate active energy, kcal |
| `sensor.fitness_move_energy_today`, `move_energy_goal` | Energy-based Move ring, kcal |
| `sensor.fitness_exercise_today`, `exercise_goal` | Exercise ring, min |
| `sensor.fitness_stand_hours_today`, `stand_goal` | Stand ring, h |
| `sensor.fitness_move_time_today`, `move_time_goal` | Time-based Move ring, min |
| `sensor.fitness_latest_sleep` | Most recent sleep session, min, with wake-up `date` |
| `sensor.fitness_last_workout` | Latest completed workout end, timestamp |
| `sensor.fitness_last_workout_duration` | Duration, s |
| `sensor.fitness_last_workout_distance` | Distance, m |
| `sensor.fitness_last_workout_energy` | Energy, kcal |
| `sensor.fitness_last_sync` | Latest received batch, timestamp |
| `binary_sensor.fitness_all_rings_closed_today` | All tracked ring values meet positive goals |

Entity IDs may differ if the display name changes or another entity owns the
same ID. Discover your actual IDs in the integration's entity list.

Daily sensors use the account's reporting calendar, including 23/25-hour DST
days, and carry `date` and `time_zone` attributes. A missing day becomes unknown;
yesterday is never reused as today, and missing/null data is never invented as
zero. Ring closure supports both Move energy and Move time modes. Untracked
rings or absent/invalid goals produce unknown, rather than a false celebration.
Daily totals use HA's `total` state class because late sync/recomputation can
reduce a day's value. Their `last_reset` marks account midnight so a new day
starts a new statistics period; they are not an ever-increasing lifetime counter.

Sleep is the latest session within the seven-day lookback, not a sum of naps
and overnight sleep. Workout timestamps and last sync are converted from epoch
milliseconds to timezone-aware timestamps. Workout attributes contain UUID,
activity type, start and end; no routes, sample streams, names, or email addresses
are stored as attributes.

**Privacy:** configuring this integration copies health summaries and the API
credential into your Home Assistant installation. Its recorder/history, dashboards,
backups and anyone with access to them may retain or reveal those summaries.
The token is stored in HA's configuration entry storage and included in backups;
a password field masks UI input, it does not encrypt the storage. No token or
response body is emitted in integration logs, and no diagnostics exporter is
provided. Keep HA and its backups private, review external sharing/voice exposure,
and configure recorder exclusions if you do not want a health history there.
Removing the integration does not purge existing recorder history or backups.

## Dashboard example

Paste into a manual dashboard card after replacing entity IDs as needed:

```yaml
type: entities
title: Fitness
entities:
  - sensor.fitness_steps_today
  - sensor.fitness_move_energy_today
  - sensor.fitness_exercise_today
  - sensor.fitness_stand_hours_today
  - binary_sensor.fitness_all_rings_closed_today
  - sensor.fitness_latest_sleep
  - sensor.fitness_last_workout
  - sensor.fitness_last_sync
```

## Automation example

This explicit `off → on` transition avoids celebrating a goal merely because
HA restarted and loaded already-completed rings. Unknown/unavailable recovery
is intentionally not treated as a new achievement. This does not guarantee
exactly-once behavior if upstream values are subsequently corrected downward.

```yaml
alias: Celebrate closing activity rings
triggers:
  - trigger: state
    entity_id: binary_sensor.fitness_all_rings_closed_today
    from: "off"
    to: "on"
actions:
  - action: persistent_notification.create
    data:
      title: Activity goals reached
      message: All three activity rings are closed today.
mode: single
```

For completed-workout notifications, trigger on `sensor.fitness_last_workout`
and gate on a changed workout UUID and a recent end time. Exclude unknown /
unavailable recovery and initial setup so a historical workout is not announced
as a newly finished workout. No automations are installed or enabled automatically.

## Development

From the repository root with Python 3.14:

```sh
python -m venv .venv-ha
.venv-ha/bin/pip install -r integrations/homeassistant/requirements-test.txt
.venv-ha/bin/ruff check custom_components/pulshealth integrations/homeassistant
.venv-ha/bin/ruff format --check custom_components/pulshealth integrations/homeassistant
.venv-ha/bin/pytest -q integrations/homeassistant/tests
```

Tests run real Home Assistant config flows, entity platforms, coordinator outage
recovery, reauthentication, options and unload. Local HTTP fixtures verify bearer
scoping, redirect rejection, API response shapes, default-account pinning and DST.
They never connect to a real health database or contain personal health records.
