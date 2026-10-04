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
Health data, your own database
```

`[30/30]`

> Never put "Apple" in the name or subtitle: App Review treats the subtitle as
> part of the name (guideline 5.2.5). "Apple Health" in the description and
> promotional text is fine.

## Promotional text

Limit 170. Editable without a new build, so this is the line to change when
something ships.

```
Explore and export Apple Health, and sync it to your own database: full history first, then live updates. No account, no analytics, and nothing goes to the developer.
```

`[166/170]`

## Description

Limit 4000. Opens by saying where the data goes, because that is the one thing
a reader has to understand before installing. The count under the block is
characters; budget for App Store Connect counting each of its 36 line breaks
as two (3,997 today), as the review notes do.

```
PulsHealth lets you explore your iPhone's health data, export it to files, and sync it to a database: one you run yourself, or the PulsHealth database, with an account.

The app uploads only to the database you set up, and nowhere else. Run your own and the developer never receives your data. Choose the PulsHealth database, by approved request, and the developer holds it for you alone.

Your own database takes one Docker command: the open-source PulsHealth stack sets up PostgreSQL, Grafana, a web viewer, an API and an MCP server for AI assistants. Or use one you already run, through the open sync protocol.

No database yet? Explore shows what is in Apple Health, type by type, and Export writes it to CSV or JSONL files on your iPhone, on demand, to save or send wherever you like. Connect one from the Sync tab whenever you want continuous sync.

WHAT IT DOES

• Full history first. The initial backfill exports everything from the start date you choose, and saves its place after every batch so it is safe to interrupt.
• Then it keeps up. New samples follow automatically — in the foreground whenever you open the app, and in the background when iOS allows it.
• You pick the data. Around 80 HealthKit types grouped the way Apple Health groups them: activity, heart, body, respiratory, sleep, nutrition, vitals, workouts and more. Turn on a starter set in one tap, or choose type by type.
• See what you have. Explore lists every type by category. Open one to see its past year: how many samples, from which apps and devices, how the values are spread and how much arrives each day, plus a line on what the type measures. Summaries only; no samples are kept.
• More than raw numbers. Workouts carry their GPS route and per-second sensor series; activity rings come across as daily summaries; and any quantity type can also be sent as on-device aggregates (hourly sums, daily averages) instead of, or alongside, raw samples.
• Export to files. With or without a database, build each export on its own: the types and series you want, for the last 30 days, 90 days, a year, all time, or a date range you choose, to CSV (one file per kind of data, for spreadsheets) or JSONL (complete, and replayable into your database later), then save to Files or share.
• Set up in a minute. Sign in to your PulsHealth account from the Sync tab, or scan the pairing QR code your own stack prints, with its URL, token and user ID — or type them in by hand.
• Nothing is hidden. A live event log, per-type counters, a background-activity screen showing every wake iOS granted, and an export of it all for offline analysis.

PRIVACY

• Read-only. PulsHealth reads from Apple Health and never writes, changes or deletes anything there.
• One destination for your data: the database you set up. HTTPS is required for anything that is not on your own local network.
• An export makes no network request. The files are staged in temporary storage, handed to the iOS share sheet, and deleted from the app once shared.
• No analytics, no advertising, no tracking, no third-party SDKs — the app and its sync library have zero third-party dependencies.
• Your bearer token lives in the iOS Keychain, bound to this device.
• The camera is used for exactly one thing: reading the pairing QR code. No image is stored or sent; declining it simply means typing the details instead.

Privacy policy: pulshealth.com/privacy

OPEN SOURCE

PulsHealth is Apache-2.0 licensed. The app, the sync library, the wire protocol with its JSON Schema, the self-hosted stack, and the Grafana dashboards are all in one public repository, github.com/PulsHealth/pulshealth. Connecting a database of your own? The protocol is specified, with a fixture corpus to test against.

REQUIREMENTS

iPhone running iOS 17 or later. Syncing needs a database you can reach: your own, or an approved PulsHealth account. Exploring and exporting need neither. Apple Watch data arrives once iOS syncs it to the phone.
```

`[3961/4000]`

## Keywords

Limit 100 characters, comma-separated, no spaces after commas (a space costs a
character). Singular forms only — the App Store matches plurals itself — and
the words already in the name and subtitle are omitted, because those are
indexed anyway.

```
healthkit,sync,export,self-hosted,backup,postgres,grafana,quantified,csv,privacy,open source,sql
```

`[96/100]`

> "database" and "data" are in the subtitle, so they are indexed already and
> left out here; "sql" takes the place "data" had.

## URLs

| Field | Value |
|---|---|
| Support URL | `https://pulshealth.com/support` |
| Marketing URL | `https://pulshealth.com` |
| Privacy Policy URL | `https://pulshealth.com/privacy` |

All three are pages of the marketing site (`site/`). The privacy page renders
[`docs/privacy-policy.md`](../privacy-policy.md), which stays the source of
truth for the text; its GitHub page is the fallback URL if the site is ever
down. The "Privacy policy:" line in the description has to match whichever URL
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
| Medical or treatment information | None | The app shows the user their own HealthKit data, summaries of it, and its sync status. A Type page also shows one line on what the type measures and, behind the value histogram, the typical range from the project's knowledge base — general reference, not advice: the app offers no diagnosis, interpretation of the user's own values, dosage, recommendation, or treatment information. **If App Review disagrees**, the correct fallback is "Infrequent/Mild", which still yields 12+; do not argue the point at the cost of a rejection. |
| Unrestricted web access | No | There is no browser and no web view of the app's own. Its one in-app web page is the PulsHealth database's sign-in sheet: Sync → Database → Sign In to PulsHealth (or Request Access) opens `app.pulshealth.com/account` (or `/signup`) in iOS's `ASWebAuthenticationSession`, which has no address bar and serves the account flow on that site (sign in or ask for access, then Connect this iPhone), and closes when that page hands back the pairing code or the person closes it. The app has a fixed handful of links that open in Safari, outside the app: Settings → About (the GitHub repository, its issue tracker, the privacy policy and the documentation, all on pulshealth.com or github.com), the last first-run page’s "Learn more" (pulshealth.com/docs/server/), and the PulsHealth database's What the Developer Holds, Manage Account and Delete PulsHealth Account (app.pulshealth.com and pulshealth.com/privacy). It *opens* iOS Settings after camera access is declined, from Settings → Health Access, from the Explore tab's "Open Health Settings" and from an export's Health-access notice. It *receives* one kind of URL — a `puls://pair?…` pairing link, through its registered `puls` scheme — which opens nothing: it raises a confirmation naming the address it points to and, if accepted, fills in the database fields. The sign-in sheet returns the same kind of link straight to the screen that opened it, which fills in the fields the same way; either way only Save & Apply applies them. |
| User-generated content, chat or messaging | No | Nothing a user types (their own name, e-mail, database URL, token) is shared with any other user or with the developer. |
| Gambling and contests | No | — |
| In-app purchases | No | No StoreKit. |
| Advertising | No | No ad SDK, no ad network. |

## App Privacy — "Data Linked to You"

Since 2026-10-02 App Store Connect's App Privacy declares six data types,
each **used for App Functionality only, linked to the user's identity, and
not used for tracking**:

| Category | Data type | What it is in PulsHealth |
|---|---|---|
| Contact Info | Name | The optional name field the app uploads with the identity snapshot |
| Contact Info | Email Address | The optional email field, the same way |
| Health & Fitness | Health | Synced HealthKit samples, plus date of birth and sex from the identity snapshot |
| Health & Fitness | Fitness | Workouts, routes and activity rings |
| Identifiers | User ID | The user UUID sent with every upload (`X-User-ID`) |
| Identifiers | Device ID | The per-install UUID the app generates for itself (`deviceID`) |

Before that date the answer was **"No, we do not collect data from this
app"**, and for anyone using their own database it still describes what
happens. Apple defines "collect" as transmitting data off the device *in a
way that lets you or your third-party partners access it for longer than is
necessary to service the request*. The label is per app, not per user, so it
now declares what the developer collects from the people who use the
developer's own database:

1. **The app sends data to no developer server unless the person chooses
   the PulsHealth database.** The developer runs one database and viewer of
   their own (`app.pulshealth.com`) for people they invite and, since
   2026-10-02, for people whose access request they approve. The app offers
   it on Sync → Database as the **PulsHealth database**, next to your own.
   The developer addresses in the app are web pages it opens on a tap:
   `pulshealth.com` (documentation, the privacy policy) and
   `https://app.pulshealth.com` (`PulsHealth/Sources/PulsHealthDatabase.swift`),
   whose account and sign-up pages open in an `ASWebAuthenticationSession`
   when the person taps Sign In to PulsHealth or Request Access.
   The database's own address, a token and the user ID come back from that
   page as an ordinary pairing code, and no health data is uploaded until
   the person taps Save & Apply (before that, only a connection test). (1.6 and earlier have no sign-in sheet and
   reach that database only through the pairing code the account page
   shows, like anyone's database.) The source is public, so this is
   checkable rather than a promise. **For the people who choose it, it is
   collection by the developer,** which is what the six types above
   declare. The privacy policy's "If you use the developer's viewer" section
   says what happens to that data. Connecting an AI assistant to that
   database (the viewer's OAuth consent, since 2026-10-04) changes none of
   this: it happens on the website, not in the app, which gains no request,
   permission or store for it; it adds no data type the app sends; and the
   assistant's provider receives what it reads at the person's own
   direction, revocably, not as the developer's partner — so it is neither
   new collection by the app nor tracking. If the developer's instance ever stops
   taking anyone outside the household, and the app no longer offers it,
   the answer can go back to "Data Not Collected".
2. **For everyone else, the only destination is chosen and controlled by the
   user.** The database URL is typed in by the user or scanned from a QR
   code their own backend printed. It is their infrastructure, not a
   third-party partner of the developer's, and the developer has no access
   to it. The same goes for an on-device export (the Export tab): the app
   makes no network request for it at all. It writes files and hands them
   to the iOS share sheet, and the user picks where they go. Neither the
   developer nor any partner can reach them, so it is not collection either.
3. **There is no analytics, advertising, attribution, or crash-reporting SDK,
   and no third-party dependency at all.** See `PulsHealthSync/Package.swift`,
   which declares none. So no data type is declared for any purpose but App
   Functionality.
4. **Nothing is used for tracking.** `PrivacyInfo.xcprivacy` declares
   `NSPrivacyTracking = false` with an empty `NSPrivacyTrackingDomains`, and
   there is no advertising identifier and no `identifierForVendor` use. The
   `deviceID` that rides an upload is a UUID the app generates for itself.

The app's privacy manifest (`PulsHealth/PrivacyInfo.xcprivacy`) lists the
same six types in `NSPrivacyCollectedDataTypes`, linked, not tracking, for
App Functionality, from the first build after 1.6 (19). The `PulsHealthSync`
package's own manifest keeps that list empty: the library sends data only
where its host app points it, so what counts as collection is the app's to
declare. Both declare no tracking and no tracking domains, and one
required-reason API, `NSPrivacyAccessedAPICategoryUserDefaults` with reason
`CA92.1`, for the app's own flags.

## Other App Store Connect answers

| Field | Answer |
|---|---|
| Encryption (`ITSAppUsesNonExemptEncryption`) | `false`, already in `Info.plist`. The app uses only HTTPS through the OS, which is exempt. No compliance documentation is needed. |
| Content rights | The app contains no third-party content. |
| Sign in with Apple | Not required (guideline 4.8 applies to third-party or social login, and there is none). The PulsHealth database's account is the developer's own email-and-password account, created on its website by approved request; the app opens its sign-in page and never sees the password. |
| Made for Kids | No. |
| Price | Free. |
| Availability | All territories. |
| App Review contact | The maintainer fills this in — App Store Connect asks for a name, phone number and e-mail address, which are personal details and are deliberately not stored in this repository. |
| Demo account | Yes: a self-service demo account on the PulsHealth database, which the maintainer creates and approves at submission time and purges after review. Its email and password go in App Store Connect's sign-in fields and the notes' placeholders, never in this repository. See [`review-notes.md`](review-notes.md); the throwaway database of [`review-backend.md`](review-backend.md) is now optional, for the your-own-database path. (Explore and Export work without either, and the notes say so.) |

## Version information

| Field | Value |
|---|---|
| App Store | [id6757657354](https://apps.apple.com/us/app/pulshealth/id6757657354) |
| Bundle ID | `com.pulsHealth.PulsHealth` — the identifier on the store record, and what `PulsHealth/project.yml`'s `bundleIdPrefix` (`com.pulsHealth`) produces |
| Version / build | `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in `PulsHealth/project.yml`. The store holds 1.6 (19); bump both before the next archive — see the [Release record](README.md#release-record) |
| Minimum iOS | 17.0 in `project.yml` |
| Devices | iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`). The store record has been universal since 1.3, and App Store Connect refuses an update that drops a device family the previous version supported ([QA1623](https://developer.apple.com/library/ios/#qa/qa1623/_index.html)); the listing carries an iPad screenshot for the same reason |

"What's New in This Version": draft the next submission's text here, written
for someone who has the current version, and delete it once that version is
live — App Store Connect keeps the history.

> Recovery HRV: on iOS 27, PulsHealth can now sync the RMSSD heart rate
> variability your Apple Watch records on watchOS 27, next to the HRV it
> already sends. Turn it on in Sync → Synced Data → Heart.

## Screenshots

Required: 6.9" iPhone (1320 × 2868 or 1290 × 2796). Apple scales those down for
the smaller sizes, so one set is enough.

**The store files are not kept in this repository** (the README carries four
of them at 600 px). The screens worth showing — Explore with data behind it,
a Type page's charts — are only meaningful with Health data behind them. An
empty simulator has none: every count is zero and every type says "No
data", and shipping that would misrepresent the app. Two honest ways to get
data behind them: a real device with real data, from a build signed with the
maintainer's team; or the simulator with the app's built-in demo fixtures
(`-PulsFixtureProfiles 1`, `ExploreFixtures.swift`: synthetic profiles for
Sleep, Heart Rate, Steps, Cycling Distance and Workouts — nobody's real health
data), which is how 1.6's set was made. The order below tells the story a
browser needs:

1. **Unlock your Health Data** — the first onboarding page: Explore, Export
   and Sync. This one *is* honest from the simulator if a device is
   unavailable.
2. **Explore with data** — the catalog by category, each row with its sample
   count over the past year and when its last sample arrived. Real data, or
   the demo fixtures.
3. **A Type page** — the one-line description, the analysis charts (the
   histogram with its typical range, samples over time) and the aggregate
   preview for one type (Heart Rate or Body Weight). Real data, or the demo
   fixtures (Heart Rate).
4. **Export builder** — types, a series, a custom range, CSV or JSONL. Fine
   from the simulator if the selection is realistic.
5. **Sync status** — the status card after a backfill: real totals and
   per-type rows. Device only.
6. **Background Activity** — the wake log after a few days of real background
   delivery. Device only, and it needs the days.

Do not paste marketing text over them, and do not use another person's health
data.

**The current store set** (1.6, all dark mode, demo fixtures): 6.9" slot
(1320 × 2868, iPhone 17 Pro Max simulator on iOS 26.5, status bar at 9:41) —
1 Unlock your Health Data (first-run page 1), 2 Explore, 3 Heart Rate's Type
page, 4 the same page scrolled to the value histogram and samples over time,
5 the Export builder, 6 Sync to your own database (first-run page 4; the
page now reads "Sync to a database", so retake shot 6 for the next
submission). iPad 13"
slot (2064 × 2752): Unlock your Health Data and Explore. Shots 5 and 6 of the
order above (Sync status after a backfill, Background Activity) need a real
device and days of wakes; they can join the set in a later version.
