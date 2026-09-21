# App Store listing copy

Everything that goes into the App Store Connect record for the iOS app, ready
to paste. Character limits are Apple's; the counts in brackets are the current
text's, so an edit that overruns is obvious.

Locale: **English (U.S.)**, the only localisation.

---

## Name

Limit 30.

```
PulsHealth
```

`[10/30]`

> The name is reserved to the maintainer; a fork must not publish under it. See
> [`TRADEMARK.md`](../../TRADEMARK.md).

## Subtitle

Limit 30.

```
Your health data, your server
```

`[29/30]`

> Do not put "Apple" in the name or subtitle. App Review rejected 1.4 (14)
> under guideline 5.2.5 for "Apple Health to your server" here, because the
> subtitle counts as the app's name. "Apple Health" in the description and
> promotional text was not objected to.

## Promotional text

Limit 170. Editable without a new build, so this is the line to change when
something ships.

```
Sync Apple Health to a server you run yourself: full history first, then live updates. No account, no analytics, and nothing is ever sent to the developer.
```

`[155/170]`

## Description

Limit 4000. Opens by saying where the data goes, because that is the one thing
a reader has to understand before installing.

```
PulsHealth copies the health data on your iPhone to a server you run yourself.

That is the whole idea. There is no PulsHealth account and no PulsHealth cloud. The app uploads to the one address you enter, and nowhere else. The developer never receives your data, because there is nothing for it to be sent to.

You need a server. PulsHealth is the phone half of an open-source project; the other half is a backend you run — on a home machine, a NAS, a Raspberry Pi, or a rented box — with one Docker command. Without a server there is nothing to sync to, so please set that up first. Everything is at github.com/PulsHealth/pulshealth.

WHAT IT DOES

• Full history first. The initial backfill exports everything from the start date you choose, with live progress and an ETA, and saves its place after every batch so it is safe to interrupt.
• Then it keeps up. New samples follow automatically — in the foreground whenever you open the app, and in the background when iOS allows it.
• You pick the data. Around 80 HealthKit types grouped the way Apple Health groups them: activity, heart, body, respiratory, sleep, nutrition, vitals, workouts and more. Turn on a starter set in one tap, or choose type by type.
• More than raw numbers. Workouts carry their GPS route and per-second sensor series; activity rings come across as daily summaries; and any quantity type can also be sent as on-device aggregates (hourly sums, daily averages) instead of, or alongside, raw samples.
• Set up by scanning. The server prints a pairing QR code with its URL, token and user ID in it. Scan it and you are connected — or type the three values in by hand if you prefer.
• Nothing is hidden. A live event log, per-type counters and anchors, a background-activity screen showing every wake iOS granted, a throughput benchmark, and an export of all of it for offline analysis.

PRIVACY

• Read-only. PulsHealth reads from Apple Health and never writes, changes or deletes anything there.
• One destination. The server URL you configure. HTTPS is required for anything that is not on your own local network.
• No analytics, no advertising, no tracking, no third-party SDKs — the app and its sync library have zero third-party dependencies.
• Your bearer token lives in the iOS Keychain, bound to this device.
• The camera is used for exactly one thing: reading the pairing QR code. No image is stored or sent, and declining camera access simply means typing the details instead.

Privacy policy: pulshealth.com/privacy

OPEN SOURCE

PulsHealth is Apache-2.0 licensed. The app, the sync library, the wire protocol with its JSON Schema, the reference server, and the Grafana dashboards are all in one public repository. If you would rather write your own backend, the protocol is specified and there is a fixture corpus to test against.

REQUIREMENTS

iPhone running iOS 17 or later, and a server you can reach. Apple Watch data arrives once iOS syncs it to the phone.
```

`[2992/4000]`

## Keywords

Limit 100 characters, comma-separated, no spaces after commas (a space costs a
character). Singular forms only — the App Store matches plurals itself — and
the words already in the name and subtitle are omitted, because those are
indexed anyway.

```
healthkit,sync,export,self-hosted,backup,postgres,grafana,quantified,csv,privacy,open source,data
```

`[97/100]`

## URLs

| Field | Value |
|---|---|
| Support URL | `https://pulshealth.com/support` |
| Marketing URL | `https://pulshealth.com` |
| Privacy Policy URL | `https://pulshealth.com/privacy` |

All three are pages of the marketing site (`site/src/app/support`, `/privacy`,
`/terms`), which is what the plan meant by hosting the docs on the project's
own domain. **Check the App Store Connect record actually points there** — a
submission made before the site existed would carry the repository URLs
instead:

- The repository page `https://github.com/PulsHealth/pulshealth/blob/main/docs/privacy-policy.md`
  also works, and Apple accepts it. It is the fallback if the site is down.
- [`docs/privacy-policy.md`](../privacy-policy.md) stays the source of truth
  for the text. Change it and the site page changes with it — and the
  "Privacy policy:" line in the description above has to match whichever URL
  is on the record.

## Category

| Field | Value |
|---|---|
| Primary | Health & Fitness |
| Secondary | Utilities |

Health & Fitness is where a HealthKit app belongs and is what reviewers expect
from the entitlement. Utilities as secondary because the app is a data pipe
rather than a coach or a tracker — nobody browses Health & Fitness looking for
a sync tool, and Utilities catches the people who are.

## Age rating

Answer every content question **None / No**. The result is **4+**.

| Question | Answer | Why |
|---|---|---|
| Cartoon or fantasy violence, realistic violence, prolonged graphic violence | None | No such content. |
| Sexual content or nudity | None | — |
| Profanity or crude humour | None | — |
| Alcohol, tobacco or drug use or references | None | The app can sync HealthKit medication-dose records if the user turns that type on. It displays no drug information of its own, names no substance, and encourages nothing. |
| Mature or suggestive themes | None | — |
| Horror or fear themes | None | — |
| Simulated gambling, contests | None | — |
| Medical or treatment information | None | The app shows the user their own HealthKit data and its sync status. It offers no diagnosis, interpretation, dosage, recommendation, or treatment information of any kind. **If App Review disagrees**, the correct fallback is "Infrequent/Mild", which still yields 12+; do not argue the point at the cost of a rejection. |
| Unrestricted web access | No | There is no browser, no web view, and no link out. The single `openURL` call opens iOS Settings after camera access is declined. |
| User-generated content, chat or messaging | No | Nothing a user types (their own name, e-mail, server URL, token) is shared with any other user or with the developer. |
| Gambling and contests | No | — |
| In-app purchases | No | No StoreKit. |
| Advertising | No | No ad SDK, no ad network. |

## App Privacy — "Data Not Collected"

In App Store Connect, App Privacy, answer **"No, we do not collect data from
this app."**

Apple's own definition is the reason this is right, not a technicality. Apple
defines "collect" as transmitting data off the device *in a way that lets you
or your third-party partners access it for longer than is necessary to service
the request*. PulsHealth transmits health data off the device, but:

1. **The developer operates no server.** There is no PulsHealth backend
   anywhere. Nothing in the binary points at a developer-controlled host, and
   the source is public so this is checkable rather than a promise.
2. **The only destination is chosen and controlled by the user.** The server
   URL is typed in by the user or scanned from a QR code their own server
   printed. It is their infrastructure, not a third-party partner of the
   developer's, and the developer has no access to it.
3. **There is no analytics, advertising, attribution, or crash-reporting SDK,
   and no third-party dependency at all** — see `PulsHealthSync/Package.swift`,
   which declares none.
4. **Nothing is used for tracking.** `PrivacyInfo.xcprivacy` declares
   `NSPrivacyTracking = false` with an empty `NSPrivacyTrackingDomains`, and
   there is no advertising identifier and no `identifierForVendor` use. The
   `deviceID` that rides an upload is a UUID the app generates for itself.

This is the same answer other self-hosted HealthKit exporters give, and it is
the honest one: the questionnaire asks what *the developer* collects.

The privacy manifests (`PulsHealth/PrivacyInfo.xcprivacy` and the identical one
inside the `PulsHealthSync` package) match: no tracking, no tracking domains,
an empty `NSPrivacyCollectedDataTypes`, and one required-reason API —
`NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`, the app's own
flags.

## Other App Store Connect answers

| Field | Answer |
|---|---|
| Encryption (`ITSAppUsesNonExemptEncryption`) | `false`, already in `Info.plist`. The app uses only HTTPS through the OS, which is exempt. No compliance documentation is needed. |
| Content rights | The app contains no third-party content. |
| Sign in with Apple | Not applicable — the app has no accounts and no third-party login. |
| Made for Kids | No. |
| Price | Free. |
| Availability | All territories. |
| App Review contact | The maintainer fills this in — App Store Connect asks for a name, phone number and e-mail address, which are personal details and are deliberately not stored in this repository. |
| Demo account | Not an account, but the reviewer *does* need a server. See [`review-notes.md`](review-notes.md) and [`review-backend.md`](review-backend.md). |

## Version information

| Field | Value |
|---|---|
| App Store | [id6757657354](https://apps.apple.com/us/app/pulshealth/id6757657354) |
| Bundle ID | `com.pulsHealth.PulsHealth` — the identifier on the store record, and what `PulsHealth/project.yml`'s `bundleIdPrefix` (`com.pulsHealth`) produces |
| Version | `MARKETING_VERSION` in `PulsHealth/project.yml`, currently `1.4`, ahead of the `1.3` on the store — see [Release record](README.md#release-record) |
| Build | `CURRENT_PROJECT_VERSION`, currently `14`, ahead of the shipped `13` |
| Minimum iOS | 17.0 in `project.yml`; check it against what the store listing states |
| Devices | iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`). The store record has been universal since 1.3, and App Store Connect refuses an update that drops a device family the previous version supported ([QA1623](https://developer.apple.com/library/ios/#qa/qa1623/_index.html)); the listing carries an iPad screenshot for the same reason |

"What's New in This Version" — one entry per submission. The first was:

```
First release.
```

1.4 (submitted 2026-09-18):

```
• Guided first-run setup: scan the pairing code your server prints, or type the URL and token and test the connection before you continue.
• Your server token is stored in the iOS Keychain.
• Sync progress is kept per server, so switching servers never mixes up what was sent.
• The log shows how much of each upload was new to your server.
• On a new setup, recent daily summaries upload first, so your server has something to show while history backfills.
• Fixes: no false "backfill complete" for types that produced no samples, and setup can no longer stall on the medications permission step.
```

## Screenshots

Required: 6.9" iPhone (1320 × 2868 or 1290 × 2796). Apple scales those down for
the smaller sizes, so one set is enough.

**Not included in this repository, and deliberately so.** The screens worth
showing — the dashboard with its counters, a type's history, the background
activity log — are only meaningful with a real Health database behind them, and
the simulator has none: every number is zero and every row says "not synced".
Shipping those would misrepresent the app.

Capture them on a real device with real data, from a build signed with the
maintainer's team. The order below tells the story a browser needs:

1. **First-run welcome** — states in two sentences that the app reads Apple
   Health and sends it to a server you run. This one *is* honest from the
   simulator if a device is unavailable.
2. **Connect your server** — the pairing step, with Scan Pairing Code visible.
   Also fine from the simulator.
3. **Dashboard after a backfill** — real totals and per-type rows. Device only.
4. **Data Types** — the category list with a realistic selection. Device only
   for the counts to mean anything.
5. **A type's detail screen** — anchor, throughput, timeline, server-side count.
   Device only.
6. **Background Activity** — the wake log after a few days of real background
   delivery. Device only, and it needs the days.

Do not paste marketing text over them, and do not use another person's health
data.

**What 1.4 was submitted with** (all dark mode, 1290 × 2796 in the 6.9" slot,
in this order): 1 Welcome, 2 Your Server (with `https://health.example.net`
typed in) and 4 Data Types from the iPhone 17 Pro Max simulator with the status
bar at 9:41; 3 Dashboard, 5 a type's detail (Body Weight), 6 Background
Activity and 7 the Sync Log from the maintainer's iPhone 13 Pro Max (1284 ×
2778, resized by under 1%). None shows a hostname, token, user ID or health
value — counts and dates only. The iPad slot has the Welcome screen at 13". This
set replaced 1.3's, which advertised CSV/JSON export and QR data requests the
app no longer has.
