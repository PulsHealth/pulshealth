# PulsHealth privacy policy

**Last updated: 2026-10-08**

PulsHealth is an iOS app that copies the health data on your iPhone to a
database — one **you** run, or, if you create a PulsHealth account, the
developer's own (the PulsHealth database) — or, if you have
no database, writes it to files you then save or send yourself. This policy
describes how the app and hosted service handle your data: it reads Apple Health, it uploads to the one database you set
up, it exports a file when you ask for one, and it can send a one-time export to a request destination you approve.

## The short version

- **Exploring and self-hosted sync do not send health data to the developer.**
  An ordinary export goes only where you share it; the developer receives a copy
  only if you deliberately send it to the developer, for example for support.
  A database you run is under your control. There is no telemetry endpoint, and no account is needed to use the
  app.
- **If you create a PulsHealth account and sync to the PulsHealth database,
  your data is stored there.** That is the developer's own database and
  viewer at `app.pulshealth.com`; the health data you choose to sync is kept
  in it under your account (see
  [If you use the developer's viewer](#if-you-use-the-developers-viewer)).
  Regular sync sends your data only to the database you set up. A one-time request can send an export to a separate destination you approve. The developer's addresses in it are web pages it
  opens when you tap a link or button: on `pulshealth.com` (the
  documentation and this policy) and, in versions that offer the PulsHealth
  database, on `app.pulshealth.com` (signing in, creating an account, managing
  or deleting your account). They open in Safari or in iOS's sign-in sheet,
  and handle the information you enter there. Regular health uploads go to the
  configured sync receiver, not to those account pages.
- **An AI assistant reads your data only if you connect one, and only
  from the database, never from the app.** If you use the PulsHealth
  database, you can connect an assistant such as Claude to your records by
  signing in and approving it (see
  [If you use the developer's viewer](#if-you-use-the-developers-viewer)).
  Its provider then receives what the assistant reads, under the
  provider's own terms. The app is not involved, and the developer sends
  your data to no AI provider on its own.
- **You choose each way health data leaves the phone.** Regular sync uploads
  to the database you configure and apply. The Export tab writes files for the
  iOS share sheet. A one-time Data Request writes a ZIP and either opens that
  share sheet or, after you review the destination and tap **Generate & Send**,
  uploads it directly to that HTTPS destination. Opening or scanning a request
  alone reads and sends no health data.
- **No analytics, no advertising, no tracking, no third-party SDKs.** The app
  and its `PulsHealthSync` library have zero third-party dependencies. Nothing
  profiles you for advertising. Exports and sync contain the identifiers described below.
- **HealthKit access is read-only.** PulsHealth asks Apple Health for read
  permission and never writes, edits, or deletes anything in Apple Health.
- **You choose what is read.** Nothing is read until you pick the data types
  and iOS grants permission, and you can change or revoke that at any time.

## App Store ratings and reviews

The app may ask Apple's StoreKit framework to show its standard review prompt
at a pause after a completed task. Apple decides whether to show it and
handles any rating or review you choose to submit under Apple's terms.
Settings → About → Write a Review opens the App Store review page. Neither
path sends health data to Apple. StoreKit does not tell the app whether you
submitted a rating or review; any review you publish is visible on the App
Store. The timing counters described below remain in the app's own preferences.

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
name, email address, date of birth, biological sex — to the database you choose, including PulsHealth hosting, so
your data is stored under a person rather than an anonymous row and so
heart-rate zones can be computed. Every one of those fields starts unset. You
type them into Settings → User; the app never reads them from Apple Health or
anywhere else, and leaving them blank is fully supported.

Each upload also carries a `deviceID` so your database can tell one phone from
another. It is a random UUID the app generates for itself on first run — not
the advertising identifier, not `identifierForVendor`, not a hardware identifier; on a hosted account it is associated with you — and it goes only to your database, and into the files of an
export you make yourself.

## Where it goes

To the database you configure — the PulsHealth backend you run, a receiver
you built from the protocol, or the PulsHealth database if you chose it and
signed in — over HTTPS, authenticated with a bearer token. One-time requests can send a ZIP to a separate HTTPS destination you explicitly approve; ordinary exports go through the share sheet. See [Data Requests](#data-requests).

**Signing in to the PulsHealth database.** Sync → Database → PulsHealth
Database → Sign In to PulsHealth opens the phone connection page at
`app.pulshealth.com` in iOS's sign-in sheet, after iOS asks whether the app
may use that site to sign in. The sheet is a browser run by iOS: what you
type into it goes to the developer's viewer, not through the app, and it
shares Safari's website data, so a sign-in made in Safari (where the email
inviting you to choose a password opens) carries over, and the viewer's
cookie is kept by iOS with Safari's, not by the app. On that page, Connect
this iPhone hands the app a pairing code — the
database's address, a token for this iPhone and your user ID — which fills
in the database fields, and shows the database it points to. The app
accepts only a pairing code from that sheet and checks it like a scanned
one. A code whose database is not under `pulshealth.com` is filled in as
your own database, with a warning naming its address, never as the
PulsHealth database; and the PulsHealth database is always shown with its
address. Before you tap Save & Apply it does one thing with it: a connection
test, which asks that database what it supports, using the token, and
uploads no health data. Closing the sheet changes nothing. Create Account
opens the developer's sign-up form in the same sheet; What the Developer
Holds, Manage Account, Connect an AI Assistant and Delete PulsHealth
Account open the developer's pages in Safari, outside the app. A pairing code from the account page
opened on the iPhone in Safari (where the invite email leads) instead
reaches the app as an ordinary pairing link, which the app asks you to
confirm and then treats like any database's. (Versions up to 1.6 have no
sign-in sheet: there, the account page's pairing code is scanned or opened
like any other.)

Plain `http://` is permitted **only** for hosts on your local network
(`localhost`, `*.local`, and the private IP ranges `10.x`, `172.16–31.x`,
`192.168.x`), because a self-hosted database commonly lives on a home network
where a public TLS certificate is awkward. Every other address must be `https://`;
the app refuses to save or use a plain-HTTP address for any host outside those
ranges. This is enforced both by the app's own validation and by iOS App
Transport Security (`NSAllowsLocalNetworking`).

## What stays on the device

- **The bearer token** is stored in the iOS **Keychain**
  (`kSecClassGenericPassword`, accessibility
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — readable after the first
  unlock following a restart so background syncs can run, and bound to this
  device so it is never restored onto another one from a backup). It is
  scrubbed out of logged error messages and anything the app exports.
  **One exception, and only when the Keychain refuses a write:** rather than
  lose the token — which would stall every sync until you typed it in again —
  the app keeps it in its own state file until the Keychain accepts it, then
  removes it. That file carries the same protection as the rest of the app's
  data: unreadable until the first unlock after a restart, and excluded from
  device and iCloud backups, so a parked token is never carried off the phone.
- **Sync state** — one file, `sync-state.json`, in the app's private container,
  holding your configuration (database URL, chosen types, start date, the
  identity fields if you filled them in, and — if you signed in to the
  PulsHealth database — the database address that sign-in delivered, so the
  app can tell that database from one you run), the opaque HealthKit query anchors,
  per-type counters, and progress watermarks. It is written atomically with
  iOS file protection and is excluded from device backups. It holds **no health
  samples** — a sync streams those to your database and keeps none of them in
  the app. The one time health samples rest in the app's storage is an export you
  asked for, briefly, as described under [Exports](#exports); the analysis
  summaries below are derived numbers, not samples.
- **Analysis summaries** — when you analyze a data type on the Explore tab,
  the app reads the past year of that type from Apple Health and keeps a
  *summary* of it, one
  small file per type (`profiles/<type>.json` in the app's private container),
  so the next visit does not repeat a read that can take minutes: how many
  samples there are, the first and last dates, how many fall on each day, the
  spread of values (minimum, maximum, average, a few percentiles and a
  histogram of at most a few dozen bins), the typical time between samples,
  and how many came from each source app or device, by name. It never holds
  an individual sample, a timestamp paired with a value, a sample identifier
  or any metadata. These files carry the same protection as the sync state
  (unreadable until the first unlock after a restart, excluded from backups),
  are rewritten when the type's data changes, and Settings → Privacy & Data →
  Delete Analysis removes all of them at once.
- **Logs and background-activity telemetry** — an in-app event log and a record
  of each background wake (when it ran, how long, how many samples moved). They
  stay on the device unless *you* share them from the Activity
  screen, which writes them to the app's temporary directory for the share
  sheet and deletes them when you leave that screen (and at the next launch,
  if the app was closed first). They hold counts and timings, not health
  values.
- **App preferences and review timing** — `UserDefaults` holds Health-access,
  onboarding and background-scheduling flags, Explore display preferences,
  and the counters used to space App Store review requests: active days,
  foreground visits, successful-upload days, the latest counted upload date,
  and request-attempt dates, versions, sources (Explore, Export or Sync) and
  count. These contain no health values, type identifiers or account details,
  and are not sent to the developer or an analytics service. A request attempt
  does not indicate whether you rated or reviewed the app.

Deleting the app deletes all of this from the phone, a staged export included.
It does not delete anything already uploaded to your database, or any exported
file you saved or sent somewhere else — those are yours to manage.

## Exports

The Export tab writes the data types and series you choose for it, for the
time range you pick, to files on the phone: CSV, or JSONL (the same format the app
uploads), zipped into one file if you ask for that. It works with no database
configured and makes no network request. It
runs only when you tap Export; nothing exports on a schedule or in the
background.

- **Where the files are.** In the app's temporary directory, which iOS never
  includes in a device or iCloud backup. They carry iOS file protection
  (unreadable until the first unlock after a restart) and no other encryption.
- **How long they stay.** Until you have shared them: the app deletes its copy
  when the share sheet reports that the files were handed over. It also deletes
  it when you tap Delete Export, when you start another export, and every time
  the app launches — so an export you never shared, or one interrupted by a
  crash, does not outlive the next launch. A cancelled or failed export keeps
  nothing.
- **What is in them.** The health data you selected, as Apple Health holds it —
  which includes the name of the app or device that recorded each sample (for
  example the name you gave your Apple Watch). A manifest file beside the data
  records your user ID, the app's random `deviceID`, the phone's time zone, the
  app version, the time range and the row counts — and, when Health access is
  limited to recent history (iOS 27), the date each limited type could be read
  from; a JSONL export repeats the
  `deviceID` and app version at the head of each batch, as an upload does. The files do **not** contain the bearer token,
  the database URL, or the name, email address, date of birth or sex from
  Settings → User.
- **Where they go.** Wherever you send them from the share sheet — Files,
  AirDrop, another app. The app's Copy action is turned off for exports, so the
  files are not placed on the clipboard. Once a file has left the app it is an
  ordinary, unencrypted file: it is only as private as the place you put it,
  the app can no longer delete it, and the developer receives it only if you choose to send it to the developer.

## Data Requests

Settings → Create Request makes a self-contained link and QR code describing
requested data types, fixed inclusive dates, format, purpose, contact and an
optional HTTPS upload destination. It contains no health data or app sync
credentials. Anyone with the link can read and edit its details; requester
identity is not verified. Links expire after 30 days by default, can be reused
by multiple people, and cannot be remotely revoked. Request details appear in
the export manifest, so do not put participant secrets in them.

Opening a request shows its details before any health read. **Generate & Share**
creates a ZIP and opens the share sheet. **Generate & Send** creates that ZIP
and uploads it directly to the displayed destination in one action. A partial
extraction stops for a separate **Send Available Data** choice. Apple Health
can return no records when permission is denied; empty data does not prove
that access was granted. There is no study enrollment, participant account,
ongoing synchronization, or research consent process in this feature.

Request exports use fresh random export user and device IDs and exclude your
configured profile and sync credentials. Health records still contain source
names, sample identifiers and other potentially identifying information; the
files are not anonymized. Temporary files use the export protections described
above and are removed after confirmed delivery, successful share handoff,
deleting or closing the request, or the next app launch. A failed upload keeps
the file only for retry in the current request session. Nothing is saved as a
scheduled job or a persistent request history.

Direct delivery uses HTTPS, with no app account cookie or bearer token and no
redirects. The endpoint receives the ZIP, request ID, random submission ID,
SHA-256 checksum and normal network information such as the IP address.
PulsHealth confirms delivery only when the endpoint returns a matching receipt;
this is not verification of the recipient's identity, retention practices, or
study participation. Retry reuses the same submission ID and file. Cancel stops
further work but cannot recall a copy already received. Manage received copies
with the recipient under their own policies.

## Camera

The app uses the camera to read database pairing and Data Request QR codes.
The camera runs only while the scanning screen is open. No photo or video frame
is recorded, stored, or transmitted. Only the decoded text leaves the scanner.
If you decline camera access you can enter or paste a link instead. A pairing
link asks for confirmation before filling database fields; a request link shows
its data, dates and destination before you choose to generate or send anything.

## Health data and Apple's rules

PulsHealth does not use HealthKit data for advertising, marketing, or
data-mining purposes, and does not sell HealthKit data. Uploads go to
the database you set up — your own, or the PulsHealth database if you chose
it, where the developer holds it for you as described
[below](#if-you-use-the-developers-viewer) — and an exported file goes only
where you send it, including a request destination you approve. Likewise, the only AI assistant that reads data from the
PulsHealth database is one you connected and approved yourself, and it can
be revoked at any time.

## Children

PulsHealth is not directed at children. Hosted accounts are approved individually.
Do not submit a child's health records to the hosted service without first
contacting support@pulshealth.com about eligibility and required consent.

## What you are responsible for as a self-hoster

Because you run the database, the parts of the system that would normally be a
provider's responsibility are yours:

- **Where your database runs and who can reach it.** Exposing the ingest endpoint
  to the internet, putting it behind a VPN, or keeping it on your LAN is your
  decision. The project's documentation binds every service to loopback by
  default.
- **TLS.** The app requires HTTPS for anything that is not a local-network
  host, but the certificate and the reverse proxy in front of the ingest
  endpoint are yours to provide.
- **The tokens that let a phone write.** While the shared `PULS_TOKEN` is
  enabled, anyone who has it can upload and delete data for any user in your
  database. A per-device token is bound to one user and can be revoked on its
  own; once every phone has one, turn the shared token off
  (`PULS_ALLOW_SHARED_TOKEN=false`). Rotate or revoke any token that leaks.
- **Data at rest, backups, and deletion.** Your database holds identifiable
  health data. Encryption at rest, retention, and honouring your own deletion
  requests are yours to arrange. The project ships a backup service, but it is
  opt-in and off until you turn it on — until then the Postgres volume is the
  only copy.
- **Anyone else you let use your database.** If you host other people's data, you
  are the data controller for it, and any obligations that come with that are
  yours.
- **Anything you connect to the database.** Grafana, the web viewer, the MCP
  server for AI assistants, notebooks, and your own queries all read the same
  database. What you point at it, and what those tools do with the data, is
  outside the app's control. An AI assistant connected to the MCP server —
  with its token, or through the viewer's sign-in and consent screen if you
  turn that on — hands what it reads to that assistant's provider, under
  the provider's terms.

## If you use the developer's viewer

Sean Wade operates the PulsHealth hosted service as an individual, with its
primary database and managed backups in the United States and the web viewer
at `app.pulshealth.com` — the **PulsHealth database** the app offers under
Sync → Database. You create an account there (the app's Create Account
opens the form), or the developer invites you. What happens to your data:

- **Signing up.** The sign-up form stores your name, email address, an
  optional note, and your browser's IP address and name, and emails them to
  the developer. They are used only to set up your account and to contact
  you about it. Nothing else is created for you, and your iPhone cannot
  send anything, until your account is set up and you have chosen a
  password from the emailed link. You can ask for your sign-up to be
  removed at any time by writing to support@pulshealth.com.
- **The app still works exactly as described above.** Once your account is
  set up, you sign in from Sync → Database (or open the account page's pairing code on
  the iPhone), and the app uploads only to the database address that code
  gives it — in this case the developer's. A one-time Data Request can separately
  send an export to a destination you review and approve.
- **The developer holds your data.** Everything the app uploads (the health
  data you chose to sync, and the identity fields if you filled them in) is
  stored in the developer's database under your own user ID. This includes
  precise GPS coordinates in workout routes if you enable route syncing. The
  operator can access it. The service processes records to display your
  history, calculate charts and summaries, maintain syncing, and answer requests
  from assistants you authorize. Health data is not sold or used for advertising,
  marketing, or unrelated profiling. Access is limited to providing, securing and
  supporting the service, the service providers described below, and recipients
  you authorize. Each signed-in viewer account is restricted to its own records.
- **How storage is protected.** Uploads use HTTPS. The database uses separate
  service credentials and per-account access controls. It stores readable health
  records so the service can query them; it is **not end-to-end encrypted**, and
  these controls do not prevent the operator from reading records. The current
  hosted database and backup files do not have an additional application-level
  encryption layer. Cloudflare terminates hosted HTTPS connections as described
  below. Do not treat a user ID, a compressed backup or a password hash as
  encryption or anonymization of your health records.
- **How long records stay.** Synced health records, profile information and
  successful-upload diagnostics stay until you delete your hosted account or
  applicable records are removed by sync. Disconnecting, disabling a data type,
  revoking Health access, or uninstalling the app stops future collection as
  applicable; it does not erase records already received. Account deletion is
  the way to request removal of all hosted records. Undecided signup requests
  stay until approved, declined or withdrawn; approved signup requests are
  removed from the database after 30 days. Account email and support copies are
  handled separately as described below.
- **Sync diagnostics.** Alongside health records, the database retains an
  operational record of each upload: device/user and batch identifiers, types
  and counts, byte size, export/receipt times, and whether sync was triggered
  by foreground use, a manual action or background delivery. Wake identifiers
  correlate related uploads; the server also records processing timings.
  Authenticated uploads that fail retain status, failure stage and a bounded
  diagnostic message, without the health-data request body, for 90 days.
  These records diagnose missing or delayed sync and support the service;
  they are not used for advertising or audience analytics. Deleting your
  account removes its upload and rejection records too.
- **Reporting time zone.** The syncing phone sends its current time-zone
  identifier with uploads. For a newly approved hosted account, its first
  upload initializes the account's reporting time zone. You can change that
  setting on the account page; travel does not silently change it. Older
  accounts use the server's default until you choose a setting. It determines
  how raw samples are grouped into days and displayed. Activity rings and
  phone-computed aggregates retain the calendar in which the phone recorded
  them, so changing this setting does not rewrite those records.
- **Your viewer account.** Signing in stores your email address, a one-way
  hash of your password (never the password), and, for each browser you sign
  in from, when it signed in and was last used, its browser and system name,
  and its IP address. The viewer sets one cookie, which keeps you signed in;
  it holds a random value and nothing else.
- **The demo.** "See the live demo" signs you into a shared demo account
  that shows de-identified sample data and lets you change nothing. That
  session records no IP address or browser name, and ends after two hours.
- **Connecting your iPhone.** If you signed up, the account page
  makes a pairing code that lets your iPhone upload to your records — the
  one the app's sign-in sheet receives (family members' iPhones are paired
  by the developer). It is shown once and only a hash
  of it is kept; the account page lists your connected iPhones and lets you
  disconnect each.
- **AI assistants you connect.** You can connect an AI assistant that
  speaks the Model Context Protocol (MCP) — the Claude app or claude.ai as a
  custom connector, Claude Code, or another MCP client — to your records.
  The assistant reaches the developer's MCP server, which sends it to sign
  in at `app.pulshealth.com`; there a consent screen names the assistant (by
  the name it gave itself, which the viewer cannot verify), where it will
  send you back, and the account it will read, and nothing is granted until
  you tap Allow. What it grants is **read-only** access to all the health
  data stored under your user ID and your profile (the identity fields the
  app uploaded, such as your name and date of birth) — it cannot
  upload, change or delete anything, and it cannot read anyone else's
  records. It lasts until you revoke it under AI assistants on the account
  page, which lists each connected assistant with when it was connected and
  last used. Revoking stops it from renewing at once; the short-lived
  access it already holds runs out within **30 minutes**. Changing or
  resetting your password, having your account disabled, or deleting it
  revokes every connection the same way, and a connection unused for 60
  days lapses on its own.
  **What the assistant reads goes to its provider** — for Claude,
  Anthropic — **under that provider's terms and privacy policy, not this
  one.** The developer does not choose, see or control what the provider
  keeps, and revoking a connection stops further reads but does not delete
  what the provider already received. The developer sends your data to no
  AI provider on its own; it answers only the requests your connected
  assistant makes.
  For the connection, the viewer stores each assistant's registration (the
  name it gave itself and the addresses it may send you back to), and for
  your connection a one-way hash of its renewal token and when it was
  created, last used and revoked; the five-minute sign-in code is likewise
  kept only as a hash and used once. The 30-minute access tokens are
  signed, not stored. Deleting your account deletes your connections;
  expired codes and dead connections are deleted automatically, as is a
  registration no connection has used for 30 days.
- **Password recovery.** Forgot password sends a single-use link to the
  account's email address. It expires after 30 minutes. The database keeps
  only the link's hash and a snapshot of the account's password hash and
  password-change time to reject stale links; successful reset removes all
  recovery links for that account. Expired records are cleaned up hourly.
  Short-lived counters keyed by hashed email and IP address limit abuse and
  are also cleaned up hourly. A completed reset signs out browsers and
  revokes connected assistants (their already-issued access expires within
  30 minutes); it does not disconnect your iPhone's sync token.
- **Email and support.** Messages about your account — invitations and password-
  recovery links — are sent through Amazon Simple Email Service from
  `noreply@pulshealth.com`. There is no account mailing list. Signup notifications
  also go to the operator's mailbox. Please do not send health records or
  credentials to support unless needed to resolve a specific issue. Voluntarily
  provided support material is used only for that issue. The operator removes
  resolved support material and signup notification emails within 30 days and
  checks for these copies when handling a deletion request. Automatic database
  deletion does not itself erase a mailbox or a copy held by an outside recipient.
- **Cloudflare carries the hosted database's traffic.** `app.pulshealth.com`,
  the sync receiver at `ingest.pulshealth.com`, and `mcp.pulshealth.com` that
  a connected AI assistant reads from are reached through Cloudflare, which
  terminates their TLS connections. It handles the pages you open, the
  health data your phone uploads and the answers an assistant receives, under
  [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- **Maps.** A workout's route map is drawn by your browser fetching map tiles
  directly from the provider named on the map (Esri, OpenStreetMap or
  OpenTopoMap). Those requests carry no health data, but they do reveal to
  that provider which area the map shows, and the viewer's address.
- **Leaving.** **Delete my account and data** on the account page (the app's
  Delete PulsHealth Account, under Settings → Privacy & Data, opens it)
  disables your account, signs out browsers, disconnects iPhone uploads and
  revokes connected assistants. The service immediately attempts to remove
  your account, profile and stored health records, including derived database
  summaries and device names no other account uses. If interrupted, removal
  retries automatically; no email or operator approval is needed to finish it.
  A private status link tells you whether removal is pending or complete.
  Removal normally finishes within minutes, but a large history or service
  interruption can take longer. The operator checks delayed requests and aims
  to resolve them within 24 hours; contact support@pulshealth.com if your receipt
  is still pending then. The request alone is not a completion confirmation.
  Tap Disconnect under Sync → Database (or delete
  the app) to stop it trying to sync.
  This flow is available to approved signups and invited personal accounts
  designated by the operator. Administrator, shared demo and protected
  operator-managed accounts are not personal signups and are managed by the
  operator. If your personal hosted account is classified incorrectly, contact
  support@pulshealth.com to correct it.
- **Deletion records and backups.** The private completion receipt is stored
  as a hash with request/completion dates and status. It no longer refers to
  an account after removal and is cleared 30 days after completion by the
  cleanup worker. A minimal deletion record containing only the old internal
  user UUID and request date is retained indefinitely, including in a separate
  restore-protection ledger. It contains no name, email or health records;
  its purpose is to prevent an older database backup from restoring deleted
  data into service. A backup made before deletion can still contain the old
  data until that archive expires. Managed database backups are taken daily
  and expire after seven days, checked at least hourly while the backup service
  is running. Expiry runs even if a new backup fails. An outage can delay physical
  removal; overdue copies are removed when the service resumes and are not used
  to restore deleted accounts. There are currently no additional offsite database
  copies. Restoring an archive requires replaying
  the current deletion ledger before the restored service is opened. Copies
  you exported, or sent to another recipient or assistant, remain with those
  recipients and are not removed by deleting your PulsHealth account.

- **Operational logs.** Server security and operational logs can include network
  addresses, request or batch identifiers, status codes and timings. They are
  restricted to the operator and used for security and troubleshooting, not
  advertising. They are separate from the account database: account deletion
  does not selectively rewrite historical log files. Container logs rotate by
  size (up to five 50 MB files per service), rather than on a fixed age schedule.
  Do not send health data or credentials in URLs; infrastructure providers may
  also retain their own operational records under their policies.

## The website

Everything above is about the app and, in the section just before this one,
the developer's own viewer. This section is about pulshealth.com,
which is a separate thing.

The site is a set of static files. It loads no analytics, sets no cookies,
and includes no tracking scripts or third-party embeds. No health data ever
passes through it: the app does not talk to it, and there is nothing to sign
in to on it. Its "Sign in" link leads to the developer's invite-only viewer
at `app.pulshealth.com`, a separate site described in the section above.

Two forms on the site — "Sign up for updates" and the consulting contact
form — send exactly what you type into them (a name, an email address, and
for the consulting form an optional organisation and a message) to a form
endpoint the maintainer runs on Amazon Web Services, tagged with which form it
came from. That is the only thing the site sends anywhere, and it happens only
when you press the button. The updates list is used for the occasional
project announcement and nothing else.

## Changes to this policy

This document is versioned in the project's public repository. Changes arrive
as commits, so the full history is visible at
<https://github.com/PulsHealth/pulshealth/commits/main/docs/privacy-policy.md>.

## Contact

- **Privacy, access, deletion and support:** contact Sean Wade, the individual
  operator, at support@pulshealth.com. Do not post health records, credentials
  or private account details in public GitHub issues.
- **General software questions:** <https://github.com/PulsHealth/pulshealth/issues>.
- **Security problems:** please use GitHub's private vulnerability reporting at
  <https://github.com/PulsHealth/pulshealth/security/advisories/new>, as
  described in [`SECURITY.md`](../SECURITY.md). Do not file a public issue for a
  security problem.
