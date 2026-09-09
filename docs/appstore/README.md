# App Store submission

Everything needed to put the iOS app on the App Store, written so a submission
can be assembled from this directory without inventing facts about the app.

The app is **live on the App Store**:
[PulsHealth](https://apps.apple.com/us/app/pulshealth/id6757657354) (free,
Health & Fitness, 4+). This directory stays the source material for the
listing and for every submission after the first; what actually shipped is at
the bottom, under [Release record](#release-record).

| Document | What it is |
|---|---|
| [`listing.md`](listing.md) | The App Store Connect record: name, subtitle, promotional text, description, keywords, URLs, category, age-rating answers, the App Privacy "Data Not Collected" answer and its reasoning, and what to do about screenshots. |
| [`review-notes.md`](review-notes.md) | The App Review Information → Notes text, ready to paste once four placeholders are filled in, plus prepared answers for the questions this app invites. |
| [`review-backend.md`](review-backend.md) | How to stand up the throwaway public server a reviewer needs, and how to tear it down and rotate its token afterwards. |
| [`../privacy-policy.md`](../privacy-policy.md) | The privacy policy itself. It has to be served at a public URL; `listing.md` says how. |

Requirements these cover: **STORE-1** (privacy policy, support URLs, "Data Not
Collected"), **STORE-2** (review backend), **STORE-3** (listing, screenshots,
a description that states plainly where data goes) and **STORE-5** (the
guideline 5.1.3 statement) from
[`docs/open-source-plan.md`](../open-source-plan.md). **STORE-4** (a TestFlight
public link as the beta channel) is not covered here, and in the event was
skipped: the app went straight to the store.

## The one-sentence version

PulsHealth sends the user's health data to a server the *user* runs; the
developer receives nothing, operates nothing, and has nothing to collect. Every
document here is an application of that single fact, and every claim in them is
checkable against the source in this repository.

## Submission checklist

Work top to bottom. The items marked **maintainer only** need an Apple
Developer account, a signing team, a real device, or personal contact details,
and cannot be prepared in the repository.

### Before anything else

- [x] **maintainer only** — Reserve the name **PulsHealth** in App Store
      Connect and create the app record. Done: the record exists with bundle
      ID `com.pulsHealth.PulsHealth`, primary language English (U.S.). Note
      that `PulsHealth/project.yml`'s `bundleIdPrefix` (`com.puls`) does not
      produce that identifier — an archive for this App ID has to be built
      with the prefix the record uses.
- [ ] **maintainer only** — Confirm the paid Apple Developer team, and that the
      HealthKit and HealthKit background-delivery entitlements are on the App ID.
- [ ] Put `DEVELOPMENT_TEAM` in `PulsHealth/Config/Local.xcconfig` (gitignored,
      seeded from the tracked example by `xcodegen`).

### Host the privacy policy

- [x] Decide the Privacy Policy URL — `https://pulshealth.com/privacy`, served
      by `site/`; see [`listing.md`](listing.md) → URLs. Confirm the App Store
      Connect record points there and not at the older repository URL.
- [ ] If you choose a different URL, update it in `listing.md` **and** in the
      "Privacy policy:" line inside the description block.
- [ ] Re-read [`../privacy-policy.md`](../privacy-policy.md) against the build
      you are shipping. It is a factual claim about the binary, so any change
      to where data goes, what is stored, or what is read has to land here too.

### Fill in the listing

- [ ] Paste name, subtitle, promotional text, description and keywords from
      [`listing.md`](listing.md). The bracketed counts there are current; check
      them again if you edit.
- [ ] Set the category (Health & Fitness / Utilities), the support and
      marketing URLs, and the price (free, all territories).
- [ ] Answer the age-rating questionnaire as tabulated. Expect **4+**.
- [ ] Answer App Privacy: **no data collected**. The reasoning is in
      `listing.md` if anyone asks.
- [ ] **maintainer only** — Fill in App Review contact details (name, phone,
      e-mail). Those are personal and are deliberately absent from this repo.

### Screenshots

- [ ] **maintainer only** — Capture the 6.9" iPhone set on a real device with
      real Health data, in the order `listing.md` gives.
- [ ] Do not ship simulator screenshots of the dashboard, type detail, or
      background-activity screens: with no Health data behind them every number
      is zero and every row says "not synced", which misrepresents the app. The
      first-run welcome and server screens are the exception — they look the
      same either way.

### Review backend

- [ ] Stand up the throwaway instance following
      [`review-backend.md`](review-backend.md).
- [ ] Verify it from off-network (`/healthz` and `/v1/capabilities`).
- [ ] Walk the whole of [`review-notes.md`](review-notes.md) on a spare device,
      exactly as written, before anyone else does.
- [ ] Fill the four placeholders and paste the notes block. Keep the filled-in
      copy out of the repository — it holds a live token.

### Build and upload

- [ ] `cd PulsHealth && xcodegen` — the Xcode project is generated and
      untracked.
- [ ] Bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in
      `PulsHealth/project.yml` if this is not the first build.
- [ ] Archive for a real device with the maintainer's team and upload.
      `ITSAppUsesNonExemptEncryption` is already `false` in `Info.plist`, so
      there is no export-compliance questionnaire per build.
- [ ] Check the uploaded build's privacy report: the app and the
      `PulsHealthSync` package each ship a `PrivacyInfo.xcprivacy` declaring no
      tracking, no collected data, and `UserDefaults` / `CA92.1`.
- [ ] **maintainer only** — Consider a TestFlight public link first (STORE-4).
      Real background-delivery behaviour only shows up over days on real
      devices.

### Submit

- [ ] Submit for review.
- [ ] Expect questions about the external server and about
      `NSAllowsLocalNetworking`. Both are answered in the notes; the review
      backend makes the first one moot.

### After approval

- [ ] Tear the review instance down, volume included, and rotate `PULS_TOKEN`
      (see [`review-backend.md`](review-backend.md) § 6).
- [x] Update the root `README.md` if it still describes the app as unreleased.
- [x] Add the version and date to [Release record](#release-record) below, so
      the next submission starts from a record rather than from memory.

## Keeping these documents true

They make specific factual claims about the binary. When any of the following
changes, revisit them in the same pull request:

| If this changes | Revisit |
|---|---|
| Where data is sent, or any new outbound request | `privacy-policy.md`, `listing.md` (App Privacy), `review-notes.md` |
| A new dependency of any kind | `privacy-policy.md`, `listing.md` — "zero third-party dependencies" stops being true |
| A new permission or usage string | `privacy-policy.md`, `review-notes.md`, `PrivacyInfo.xcprivacy` |
| What is stored on the device, or where | `privacy-policy.md` |
| The first-run flow's steps | `review-notes.md` — the reviewer walkthrough is step-by-step |
| `ServerURLValidation`'s rules | `review-notes.md` — the ATS justification quotes them |
| Anything about HealthKit write access | everything; read-only is the load-bearing claim |
| What ships to the store | [Release record](#release-record) — these documents describe the shipped binary, not whatever `main` happens to be |

## Release record

What is actually on the store, so the next submission starts from a record
rather than from memory. Add a row per release.

| | |
|---|---|
| Listing | [apps.apple.com/us/app/pulshealth/id6757657354](https://apps.apple.com/us/app/pulshealth/id6757657354) |
| Bundle ID | `com.pulsHealth.PulsHealth` |
| Category / rating / price | Health & Fitness · 4+ · Free |
| First released | 2026-01-21 |

| Version | Released | Notes |
|---|---|---|
| 1.3 | 2026-01-24 | Current version on the store. |
