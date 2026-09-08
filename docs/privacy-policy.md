# PulsHealth privacy policy

**Last updated: 2026-09-08**

PulsHealth is an iOS app that copies the health data on your iPhone to a
server **you** run. This policy describes what the app does with your data. It
is short because the app does very little: it reads Apple Health, it uploads to
the one address you type in, and that is the whole of it.

## The short version

- **The developer of PulsHealth receives no data from you.** None. There is no
  PulsHealth account, no PulsHealth service, no telemetry endpoint, and no
  server operated by the developer that the app talks to.
- **Your health data goes to one place: the server you configure.** The app
  uploads only to the URL you enter (or scan from a pairing code) in the app.
  It has no other destination compiled into it.
- **No analytics, no advertising, no tracking, no third-party SDKs.** The app
  and its `PulsHealthSync` library have zero third-party dependencies. Nothing
  profiles you, and no identifier is shared with anyone.
- **HealthKit access is read-only.** PulsHealth asks Apple Health for read
  permission and never writes, edits, or deletes anything in Apple Health.
- **You choose what is read.** Nothing is read until you pick the data types
  and iOS grants permission, and you can change or revoke that at any time.

## What the app reads

Only the Apple Health data types you enable in the app, and only for the date
range you set. Depending on your selection this can include quantities (steps,
heart rate, energy, weight, blood oxygen, …), categories (sleep, mindfulness,
symptoms, …), workouts together with their GPS routes and per-second sensor
series, and daily activity-ring summaries. Some of the types you may enable are
particularly sensitive — ECG, State of Mind, medication dose events, and
workout GPS routes among them. None of these is read unless you turn it on and
iOS grants permission for it. The full catalogue is visible in the app's Data
Types screen and in [`docs/protocol/catalog.json`](protocol/catalog.json).

If you fill them in, the app also sends the identity fields you typed into it —
name, email address, date of birth, biological sex — to your own server, so
your data is stored under a person rather than an anonymous row and so
heart-rate zones can be computed. Every one of those fields starts unset. You
type them into Settings → User; the app never reads them from Apple Health or
anywhere else, and leaving them blank is fully supported.

Each upload also carries a `deviceID` so your server can tell one phone from
another. It is a random UUID the app generates for itself on first run — not
the advertising identifier, not `identifierForVendor`, not tied to you or to
the hardware — and it goes only to your server.

## Where it goes

To the server URL you configure, over HTTPS, authenticated with a bearer token
you also configure. That is the only network destination.

Plain `http://` is permitted **only** for hosts on your local network
(`localhost`, `*.local`, and the private IP ranges `10.x`, `172.16–31.x`,
`192.168.x`), because self-hosted servers commonly live on a home network where
a public TLS certificate is awkward. Every other address must be `https://`;
the app refuses to save or use a plain-HTTP address for any host outside those
ranges. This is enforced both by the app's own validation and by iOS App
Transport Security (`NSAllowsLocalNetworking`).

## What stays on the device

- **The bearer token** is stored in the iOS **Keychain**
  (`kSecClassGenericPassword`, accessibility
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — readable after the first
  unlock following a restart so background syncs can run, and bound to this
  device so it is never restored onto another one from a backup). It is never
  written to the app's state file, and it is scrubbed out of logged error
  messages and anything the app exports.
- **Sync state** — one file, `sync-state.json`, in the app's private container,
  holding your configuration (server URL, chosen types, start date, and the
  identity fields if you filled them in), the opaque HealthKit query anchors,
  per-type counters, and progress watermarks. It is written atomically with
  iOS file protection and is excluded from device backups. It holds **no health
  samples** — those are streamed to your server and not kept in the app.
- **Logs and background-activity telemetry** — an in-app event log and a record
  of each background wake (when it ran, how long, how many samples moved). They
  stay on the device unless *you* export them with the share sheet. They hold
  counts and timings, not health values.
- **App preferences** — four `UserDefaults` flags (whether Health access has
  been requested, whether medication access has been requested, whether the
  first-run flow has been completed, and the background-task schedule status).
  No personal data.

Deleting the app deletes all of this from the phone. It does not delete
anything already uploaded to your server; that is yours to manage.

## Camera

The app can read a pairing QR code printed by your server so you do not have to
type a URL, a token and a UUID by hand. That is the **only** use of the camera.
The camera runs only while the scanning screen is open, no photo or video frame
is recorded, stored, or transmitted, and nothing but the text of the scanned
code leaves the scanner. Declining camera access is fully supported: the same
screen offers to let you type the details instead, and the app works exactly the
same way.

## Health data and Apple's rules

PulsHealth does not use HealthKit data for advertising, marketing, or
data-mining purposes, and does not disclose HealthKit data to any third party.
It is not shared with, or sold to, anyone — there is nobody to share it with,
because the only recipient is your own server.

## Children

PulsHealth is not directed at children. It collects nothing centrally, so there
is no children's data for the developer to hold.

## What you are responsible for as a self-hoster

Because you run the server, the parts of the system that would normally be a
provider's responsibility are yours:

- **Where the server runs and who can reach it.** Exposing the ingest endpoint
  to the internet, putting it behind a VPN, or keeping it on your LAN is your
  decision. The project's documentation binds every service to loopback by
  default.
- **TLS.** The app requires HTTPS for anything that is not a local-network
  host, but the certificate and the reverse proxy in front of the server are
  yours to provide.
- **The bearer token.** It is a single shared secret. Anyone who has it can
  upload and delete data on your server. Rotate it if it leaks.
- **Data at rest, backups, and deletion.** Your database holds identifiable
  health data. Encryption at rest, retention, and honouring your own deletion
  requests are yours to arrange. The project ships a backup service, but it is
  opt-in and off until you turn it on — until then the Postgres volume is the
  only copy.
- **Anyone else you let use your server.** If you host other people's data, you
  are the data controller for it, and any obligations that come with that are
  yours.
- **Anything you connect to the database.** Grafana, the web viewer, the MCP
  server for AI assistants, notebooks, and your own queries all read the same
  database. What you point at it, and what those tools do with the data, is
  outside the app's control.

## Changes to this policy

This document is versioned in the project's public repository. Changes arrive
as commits, so the full history is visible at
<https://github.com/PulsHealth/pulshealth/commits/main/docs/privacy-policy.md>.

## Contact

- **Questions and general contact:** open an issue at
  <https://github.com/PulsHealth/pulshealth/issues>.
- **Security problems:** please use GitHub's private vulnerability reporting at
  <https://github.com/PulsHealth/pulshealth/security/advisories/new>, as
  described in [`SECURITY.md`](../SECURITY.md). Do not file a public issue for a
  security problem.
