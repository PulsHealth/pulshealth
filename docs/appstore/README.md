# App Store submission

Everything needed to put the iOS app on the App Store, written so a submission
can be assembled from this directory without inventing facts about the app.

The app is **live on the App Store**:
[PulsHealth](https://apps.apple.com/us/app/pulshealth/id6757657354) (free,
Health & Fitness, bundle ID `com.pulsHealth.PulsHealth`). What shipped,
and when, is the [Release record](#release-record) at the bottom.

| Document | What it is |
|---|---|
| [`listing.md`](listing.md) | The App Store Connect record: name, subtitle, promotional text, description, keywords, URLs, category, age-rating answers, the App Privacy answer ("Data Linked to You" since 2026-10-02) and its reasoning, and what to do about screenshots. |
| [`review-notes.md`](review-notes.md) | The App Review Information → Notes text, ready to paste once its placeholders are filled in (a demo account on the PulsHealth database, and optionally the review backend), plus prepared answers for the questions this app invites. |
| [`review-backend.md`](review-backend.md) | How to stand up the throwaway public server for the notes' optional your-own-database block, and how to tear it down afterwards. |
| [`crash-diagnostics.md`](crash-diagnostics.md) | Find Apple's crash stacks, preserve matching symbols, and verify a crash fix before release. |
| [`../privacy-policy.md`](../privacy-policy.md) | The privacy policy, served at `https://pulshealth.com/privacy` by `site/`. |

They cover **STORE-1**, **STORE-2**, **STORE-3** and **STORE-5** from
[`docs/open-source-plan.md`](../open-source-plan.md).

## The one-sentence version

PulsHealth sends the user's health data to a server the *user* runs — or, on
request, writes it to files the user saves or sends themselves; for those
people the developer receives nothing. The one exception is people who use
the developer's own database and viewer, by invitation or an approved
request — which the app offers on Sync → Database as the **PulsHealth
database**, reached by signing in to its one fixed address
(`PulsHealth/Sources/PulsHealthDatabase.swift`) — and
that is why App Privacy declares data linked to the user (see `listing.md`).
Every document here is an application of those facts, and every claim in
them is checkable against the source in this repository.

## Submission checklist

Before a broad hosted rollout, deploy and verify per-account reporting time
zones as described in [the release review](../release-readiness-2026-10-08.md).
Verify a newly approved account in a different phone time zone, an existing
account’s explicit zone setting, and the distinction between raw daily grouping
and activity rings/aggregates recorded in the phone’s calendar.

Work top to bottom. Items marked **maintainer only** need the Apple Developer
account, the signing team, a real device or personal contact details.

### Build and upload

- [x] Prepare `MARKETING_VERSION` 2.0 and `CURRENT_PROJECT_VERSION` 20 in
      `PulsHealth/project.yml`. App Store Connect accepted 2.0 (20) on 2026-10-08; it is selected in the
      submission draft and available to the existing internal TestFlight group,
      not yet shipped on the App Store. Recheck accepted builds before uploading; never
      reuse a build number App Store Connect has accepted.
- [x] `cd PulsHealth && xcodegen` — the Xcode project is generated and
      untracked — with `DEVELOPMENT_TEAM` in `Config/Local.xcconfig`.
- [x] **maintainer only** — Archive and upload with the signed-in Xcode:
      ```bash
      xcodebuild archive -project PulsHealth.xcodeproj -scheme PulsHealth \
        -destination 'generic/platform=iOS' \
        -archivePath "$SCRATCH/PulsHealth.xcarchive" -allowProvisioningUpdates
      xcodebuild -exportArchive -archivePath "$SCRATCH/PulsHealth.xcarchive" \
        -exportOptionsPlist "$SCRATCH/ExportOptions.plist" -allowProvisioningUpdates
      ```
      `ExportOptions.plist` sets method `app-store-connect`, destination
      `upload`, signing style `automatic` and the `teamID`; it holds the Team
      ID, so it never goes in the repository. `ITSAppUsesNonExemptEncryption`
      is `false` in `Info.plist`, so there is no export-compliance
      questionnaire.
- [x] Generate and verify Xcode Organizer’s aggregate archive privacy report: the app and the
      `PulsHealthSync` package each ship a `PrivacyInfo.xcprivacy` declaring no
      tracking and `UserDefaults` / `CA92.1`. The app's lists the eleven collected
      data types of `listing.md` § App Privacy; the package's lists none.
- [ ] **maintainer only** — Run the TestFlight build on a real device,
      installed over the store version, for a few days. Background delivery,
      continued processing and an upgrade's first sync only show up there.
- [x] Add the build to the [Release record](#release-record).

### Listing and privacy policy

- [x] Re-read [`../privacy-policy.md`](../privacy-policy.md) against the
      build. It is a factual claim about the binary: any change to where data
      goes, what is stored or what is read lands there too, and the site is
      deployed (`scripts/deploy-site.sh`) before submitting, because App Review
      reads the live `/privacy`.
- [x] Update [`listing.md`](listing.md) for what changed — description,
      promotional text, keywords, What's New — check the bracketed counts, and
      paste.
- [x] Age rating and App Privacy are answered as tabulated in `listing.md`
      (calculated 13+, or 12+ before OS 26, with regional exceptions; eleven data types,
      App Functionality, not tracking).
      App Privacy is per app, not per version. All eleven types were published
      in App Store Connect on 2026-10-08; the local manifest alone does not
      update the live label. Recheck only if the data collection changes.
- [ ] **The first release with the PulsHealth database option** (Sync →
      Database → PulsHealth Database, the in-app sign-in) contradicts copy
      that was deliberately left alone, so nothing advertised the option
      before the store had it:
      - **At submission:** replace the old live promotional text with the prepared
        accounts-aware draft in `listing.md`. It is live while the
        build is reviewed, and a listing that contradicts the build under
        review is a 2.3 rejection.
      - **Once approved:** the marketing pages `site/src/app/about/page.tsx`,
        `site/src/app/ios/page.tsx`, `site/src/app/page.tsx` and
        `site/src/lib/faq.ts`, then deploy the site.
      Delete this item afterwards.

### Screenshots

- [x] Retake the set if the screens changed, in the order
      [`listing.md`](listing.md) § Screenshots gives. Never ship simulator
      shots of Explore, a Type page, Sync or background activity **without the
      demo fixtures**: with no Health data behind them every count is zero,
      which misrepresents the app.
- [x] Keep the four images in the root `README.md` (`docs/images/app/`,
      native captures displayed at 200 px) in step with the store set.

### Review backend

- [x] **maintainer only** — Create the demo account on the PulsHealth
      database as a self-service account (Create Account on `/signup`,
      approve it on `/admin`, choose its password from the invite). It must
      be pre-approved: a new sign-up lands on the waitlist, so a reviewer
      cannot create a working account. Put
      its email and password in App Store Connect's sign-in fields
      ([`review-notes.md`](review-notes.md) § Before you submit).
- [ ] Optional, for the notes' YOUR OWN DATABASE block: stand up the
      throwaway instance following [`review-backend.md`](review-backend.md),
      and verify it from off-network (`/healthz` and `/v1/capabilities`).
      Without it, delete that block from the notes.
- [ ] Walk the whole of [`review-notes.md`](review-notes.md) on a spare device
      (or an erased simulator), exactly as written.
- [x] Fill the placeholders and paste the notes block. Keep the filled-in
      copy out of the repository — it holds a live password and token.
- [x] **maintainer only** — App Review contact details (name, phone, e-mail)
      are personal and deliberately absent from this repository.

### Release gates for accounts and Data Requests

See [the release-readiness report](../release-readiness-2026-10-08.md) for
verification evidence and remaining findings. Checked items have recorded evidence; remaining device/email checks are pending:

- [ ] Verify the deployed automatic account deletion end to end with a disposable
      approved account and an invited personal account. Confirm access stops,
      the private receipt reaches completed, and no health/profile/account rows
      remain. Verify the independent deletion ledger survives database restore
      and prevents deleted users from reappearing. Protected default/admin/demo
      users must remain protected. Check the hosted backup-retention setting,
      oldest archive and offsite copies before publishing a retention deadline.
      Apple requires whole-account deletion and clear disclosure if completion
      takes time: [account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).
- [x] Publish the eleven-type App Privacy declaration in `listing.md`, including
      Precise Location, Other User Content, the conservative Sensitive Info
      disclosure, Product Interaction and Other Diagnostic Data. App Store Connect
      confirmed publication on 2026-10-08, with all eleven types linked and used
      only for App Functionality, not tracking.
- [x] Verify Xcode’s aggregate archive privacy report against the published label;
      the published label does not replace this binary check.
- [ ] Verify the hosted signup, approval email, password setup/reset, in-app
      pairing, sync, account management and deletion on the release build.
      Confirm production migrations and server versions support that build.
- [ ] Fill approved reviewer credentials and verify them from an off-network
      device; exercise an empty Health library and a small synthetic fixture.
- [ ] Exercise Data Requests end to end: link/QR, review, share, compatible
      HTTPS delivery, partial export, timeout/manual retry and cancellation.
      Supply a disposable receiver and instructions if direct delivery is
      included in the review walkthrough. Do not frame this as an approved
      research enrollment or consent workflow.
- [x] Verify live support/privacy/account URLs and deploy the updated privacy
      policy before review. Recheck screenshot accuracy on iPhone and iPad.
- [x] Measure the final pasted description and reviewer notes after replacing
      placeholders; each must fit 4,000 characters.
- [ ] Record TestFlight upgrade/device/background checks and the exact archive
      version/build before selecting it in App Store Connect.

### Submit

- [ ] Attach the build, choose the release option and submit. Expect
      questions about the external database and `NSAllowsLocalNetworking`;
      the notes answer both.

### After approval

- [ ] Disable and purge the demo account on `/admin`, and tear the review
      instance down if there was one, volume and DNS record included
      ([`review-backend.md`](review-backend.md) § 6).
- [ ] Add the release to the [Release record](#release-record), and update
      `CLAUDE.md`'s "shipped software" bullet and `docs/roadmap.md`.

## Keeping these documents true

They make specific factual claims about the binary. When any of the following
changes, revisit them in the same pull request:

| If this changes | Revisit |
|---|---|
| Where data is sent, or any new outbound request | `privacy-policy.md`, `listing.md` (App Privacy), `review-notes.md` |
| A new dependency of any kind | `privacy-policy.md`, `listing.md` — "zero third-party dependencies" stops being true |
| A new permission or usage string | `privacy-policy.md`, `review-notes.md`, `PrivacyInfo.xcprivacy` |
| A URL scheme, or any other way another app or a web page can hand the app input (today: `puls://pair`, confirmed before it fills anything, and the PulsHealth database's sign-in sheet, which returns the same kind of code to the screen that opened it) | `privacy-policy.md` (how the server URL gets into the app), `review-notes.md` (URL SCHEME), `listing.md` (the "Unrestricted web access" row) |
| What is stored on the device, or where (today: sync state — including whether its database came from the PulsHealth sign-in — logs, four preferences, a staged export, and per-type analysis summaries) | `privacy-policy.md` § What stays on the device, `SECURITY.md`, the site's `/privacy` glance card |
| The on-device export: where files are staged, when the app deletes them (launch, new export, Delete Export, a completed share), what identity they carry, which share activities are offered | `privacy-policy.md` § Exports, `SECURITY.md`, the site's `/privacy` glance card, `review-notes.md` (WITHOUT A SERVER, HEALTHKIT), `listing.md` (description, App Privacy point 2) |
| The first-run flow's steps | `review-notes.md` — the reviewer walkthrough is step-by-step |
| `ServerURLValidation`'s rules | `review-notes.md` — the ATS justification quotes them |
| Anything about HealthKit write access | everything; read-only is the load-bearing claim |
| The maintainer's viewer instance: who may join (invitation, or an approved access request since 2026-10-02), what it stores, who carries its traffic (Cloudflare) | `privacy-policy.md` § If you use the developer's viewer, the site's `/privacy` glance card, `listing.md` (App Privacy table and point 1), `PulsHealth/PrivacyInfo.xcprivacy` |
| The app's PulsHealth database option: its address (`PulsHealthDatabase.viewerURL`), the sign-in sheet, what the screen links to, account deletion | `privacy-policy.md` (short version, § Where it goes, § If you use the developer's viewer — keep that heading, the app links to its anchor), `listing.md` (description, App Privacy point 1, "Unrestricted web access", Sign in with Apple, Demo account), `review-notes.md` (demo account, steps, ACCOUNT DELETION), `SECURITY.md`, the site's `/privacy` glance card |
| What ships to the store | [Release record](#release-record) — these documents describe the shipped binary, not whatever `main` happens to be |

## Release record

### 2.0 preparation evidence (2026-10-08)

- Build **2.0 (20)** processed successfully, is selected in the 2.0 draft,
  and is **Testing** in the existing internal TestFlight group. Physical-device
  acceptance remains pending. No App Store review submission was made.
- Seven refreshed screenshots were uploaded for each device family: iPhone
  Dynamic Island large display (1320 × 2868) and iPad 13-inch (2064 × 2752).
  The required medium iPhone slot inherits the large assets. Both sets replace
  the inherited 1.6 images and use synthetic simulator fixtures only.
- The current age questionnaire is completed: medical/treatment information
  **Infrequent**, health/wellness topics **Yes**, alcohol/drug references
  **Infrequent**. Apple calculates **13+**, with regional exceptions, and
  **12+** on operating systems earlier than version 26. No age override.
  Only app-visible content was counted: brief category descriptions include
  healthcare confirmation and intervention guidance; alcohol types describe
  drinking/intoxication, and hearing types describe safe-listening thresholds.
  Full website knowledge-base articles are not shown by the app and were not
  counted. See Apple's [rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/).
- An external beta group and the requested tester are prepared. Build 20 needs
  Beta App Review and complete test information/reviewer access before that
  tester can install it. This is separate from App Store review; neither review
  submission has been made. Tester identities and credentials stay out of this
  repository.


What is actually on the store, so the next submission starts from a record
rather than from memory. Add a row per release; builds that went to TestFlight
only are noted under the release that superseded them.

| | |
|---|---|
| Listing | [apps.apple.com/us/app/pulshealth/id6757657354](https://apps.apple.com/us/app/pulshealth/id6757657354) |
| Bundle ID | `com.pulsHealth.PulsHealth` |
| Category / rating / price | Health & Fitness (secondary: Utilities) · 4+ · Free |
| First released | 2026-01-21 |
| App Privacy | "Data Linked to You" since 2026-10-02. Published update verified 2026-10-08: eleven types (Name, Email Address, Health, Fitness, User ID, Device ID, Precise Location, Sensitive Info, Other User Content, Product Interaction, Other Diagnostic Data), all App Functionality, linked, not tracking; changed without submitting a new binary. "Data Not Collected" before 2026-10-02. |

| Version | Released | Notes |
|---|---|---|
| 1.6 (19) | 2026-10-01 | Current version on the store. Explore, Export, Sync and Settings tabs; Explore analyses of a type's past year, with summaries kept on the device; an Export builder that needs no database (CSV or JSONL, optionally zipped); iOS 27 limited Health history handled without overwriting what the app cannot read; a four-page first run whose Health page cannot be skipped, calling the sync destination "your database". Also carries 1.5's pairing from a link, the Camera app or the clipboard, and recent-data-first background sync. Built with Xcode 27.0 (iOS 27.0 SDK). Submitted 2026-09-30, approved and released automatically 2026-10-01. Screenshots from the simulator with the demo fixtures (`listing.md` § Screenshots). The review instance received no uploads. 1.5 (16) and 1.6 (17, 18) went to TestFlight only. |
| 1.4 (15) | 2026-09-19 | Self-hosted sync: first-run onboarding with QR pairing, Keychain token, per-server sync state, capabilities-gated UI, published type vocabulary. Build 14 was rejected under 5.2.5 ("Apple" in the subtitle) and 5.1.1(iv) (a skippable pre-permission screen); build 15 fixed both. Reviewed on an iPad Air 11-inch (M3). |
| 1.3 | 2026-01-24 | CSV/JSON export app with QR data requests. |

### Deployed candidate evidence — 2026-10-08

Release fixes merged in PR #173 as `d8dcfbd` after all 13 CI checks passed,
including Xcode 26.5 and 27.0. Production runs that revision; migrations 026–028,
strict seven-day backup retention and the independent deletion ledger are
verified. Disposable live account tests covered login, pairing, tenant isolation,
reporting dates, ingestion and completed deletion with revoked access.

The App Store draft holds the approved review account and final 3,488-character
notes; the existing contact details remain unchanged. A separate beta review
account prevents beta deletion testing from invalidating App Store access.
Xcode’s generated aggregate privacy report confirms all eleven declared types.
No Apple-server privacy-report claim is inferred from that local report.

Physical TestFlight acceptance and actual signup/recovery email delivery are
pending. The external tester is added, but no external build is available until
Beta App Review; the prepared beta form still needs contact email and phone.
App Store review has not been submitted.
