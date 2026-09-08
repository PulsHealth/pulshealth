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
Apple Health to your server
```

`[27/30]`

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

Privacy policy: github.com/PulsHealth/pulshealth/blob/main/docs/privacy-policy.md

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
| Support URL | `https://github.com/PulsHealth/pulshealth/issues` |
| Marketing URL | `https://github.com/PulsHealth/pulshealth` |
| Privacy Policy URL | see below |

The privacy policy has to be a public web page. The text lives in the
repository at [`docs/privacy-policy.md`](../privacy-policy.md); the maintainer
picks how it is served:

- **Now, with no extra work:**
  `https://github.com/PulsHealth/pulshealth/blob/main/docs/privacy-policy.md`.
  Public, versioned, and it renders. Apple accepts a repository page.
- **Later:** a page on the project's own domain, or GitHub Pages. If that
  happens, update this table and the "Privacy policy:" line in the description
  above, and keep the repository copy as the source of truth.

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
| Bundle ID | `com.puls.PulsHealth` |
| Version | `0.1.0` (`MARKETING_VERSION` in `PulsHealth/project.yml`) |
| Build | `1` (`CURRENT_PROJECT_VERSION`) |
| Minimum iOS | 17.0 |
| Devices | iPhone only (`TARGETED_DEVICE_FAMILY = 1`) |

"What's New in This Version" for the first submission:

```
First release.
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
