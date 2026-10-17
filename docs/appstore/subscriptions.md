# PulsHealth Pro subscription setup

Source implementation for issue #251. Both products were configured in App
Store Connect on 2026-10-15 for internal TestFlight testing with 2.2 (23).
They have not been submitted for App Review or publicly released.

| Setting | Monthly | Annual |
|---|---|---|
| Product ID | `com.pulsHealth.PulsHealth.pro.monthly` | `com.pulsHealth.PulsHealth.pro.annual` |
| Reference/display name | PulsHealth Pro Monthly | PulsHealth Pro Annual |
| Duration | 1 month | 1 year |
| US base price | $1.99 | $9.99 |

Create both auto-renewable subscriptions in one **PulsHealth Pro** group, at the
same service level. Neither includes hosting. There is no lifetime purchase,
introductory trial or consumable export credit. Use Apple's standard EULA.
The app displays Apple's localized price, not a hard-coded USD amount.

Free: full Explore; unlimited manual file exports in CSV, JSON and JSONL of all
types from the most recent 30 days; automatic sync of up to five distinct health
data types from the most recent 30 days. Raw readings and enabled aggregates of
the same type count once. Pro removes the type and history limits, subject to
Apple Health permissions. Data Requests follow the manual-export history limit.
Expiry keeps selections and server data. An over-five selection pauses in full,
with a visible explanation and a way to reduce it or upgrade. A free server can
keep accumulating data over time; this is an app read limit, not server retention.

## Local test boundaries

Hosted tests run serially through the repository runner. They use SKTestSession
for actual locally verified transactions and exercise the app's purchase-result
handling with injected checkout actions. Restore tests refresh those verified
entitlements through the native `AppStore.sync()` API in the local test
environment. Production defaults call
`Product.purchase()` and `AppStore.sync()` directly. Local passing tests do not
establish that native purchase sheets or real sandbox-account restore work. Those remain
physical-device release gates below. No sandbox account credentials are needed
for these automated tests.

The iOS 26.5 runtime cannot save StoreKitTest configuration
([Apple DTS, FB22237318](https://developer.apple.com/forums/thread/826971)).
This was reproduced both in unsigned CI and a signed local host. Its four
StoreKit fixture tests explicitly skip only on that runtime; the pure
entitlement race test and all other tests remain enabled. The iOS 27 CI job
must pass the real StoreKit lifecycle tests. These skips are a platform test
limitation, not purchase acceptance on iOS 26.5.

## Release acceptance

- [x] Create both products in App Store Connect; configure territories, tax
      category, localizations, subscription review screenshots and descriptions.
      Group ID `22482263`; monthly Apple ID `6823288020`, annual `6823289442`.
      Both are level 1, available in all 175 current territories, with English
      metadata and the parent app tax category.
- [x] Confirm the Paid Apps Agreement, tax and banking readiness: verified
      Active on 2026-10-15 (USD banking, U.S. W-9 and compliance also Active).
- [x] Set US base prices above and Apple-calculated localized prices. Annual
      billing is one upfront yearly payment, not monthly installments.
- [ ] Confirm each localized product is returned by StoreKit on a sandbox
      physical device.
- [ ] Verify purchase, restore on a fresh install, cancellation retaining access
      through the paid period, expiration, refund/revocation, Ask to Buy, billing
      grace, offline launch and app relaunch for both durations.
- [ ] Verify five versus six types, raw/aggregate deduplication, recent dates
      versus old custom ranges, all file formats and Data Request delivery.
- [ ] Verify background/observer/continued sync after expiry, preserving existing
      uploads, and historical backfill resumption after purchasing or restoring.
- [x] Maintainer updated the transition on 2026-10-17: pre-Pro users receive
      30 complimentary days, then Free limits apply. This replaces the earlier
      decision to apply Free limits immediately. There is no lifetime grant.
- [ ] Update store description, review notes, privacy answers and screenshots.
      Deploy the updated privacy policy before submitting.
- [ ] Submit the first subscription group with a subscription attached to the
      app version, then verify approval and public availability separately.

`PulsHealth/Configuration/Pro.storekit` supplies the two prices for local StoreKit
tests. It is bundled only with hosted tests and selected by the Debug Run scheme
for local purchases. It does not create production products. Disable the local
StoreKit configuration when checking real App Store Connect products on a
sandbox device; archives never use this local configuration.

The Quiet Native plan page lives at Settings → Plan and at contextual upgrade
prompts. Older exports, older sync history, an over-five sync selection and Data
Requests explain the relevant limit. Billing choices select a product; a separate
button states its localized price and billing period before starting purchase.
The yearly option is selected initially; both durations offer the same access.
Formats, raw readings and aggregates are explicitly included with Free.

Active subscribers see their verified plan and renewal or end date rather than
another sales pitch. A free offer-code transaction is described as complimentary
with no automatic charge only when verified renewal information also confirms
renewal is off. When renewal details cannot be read, the page says so and links
to Apple; it does not guess billing dates or promise no charge. The status is
in-memory only and follows the same verified access snapshot as engine policy.
If renewal status lags behind a strictly newer, verified and unexpired current
entitlement in the same subscription group, access follows that newer purchase
while renewal details remain unknown. Matching or newer status still controls
expiry and revocation; an old status never supplies renewal promises for a new
purchase.

The page offers Apple's native code redemption, Restore Purchases, subscription
management, privacy and Apple's standard EULA. Redemption completion alone never
grants access. Upgrade and restore preserve drafts and require the person to
return and explicitly export, send or apply settings. Unavailable products leave
Free usable; unverified and pending transactions do not unlock Pro.

## Existing-user thank-you (issue #283)

A verified app transaction with an original iOS build below 23 (the first
2.2 Pro build; 2.1 shipped as 22) qualifies for a 30-day gift. This uses the
original build, not the marketing version or update date. New downloads of
build 23 or later do not qualify. Apple reports `1.0` in sandbox, so sandbox
installs qualify for testing; sandbox results do not prove production eligibility.

The clock starts on the first foreground opening that can verify eligibility
and save the grant. Background-only launches never start it. A separate,
device-only Keychain item stores the fixed start/end timestamps and whether
the welcome message was dismissed; expired records remain to prevent restarting
the gift on later launches. Unavailable verification/storage can retry later;
corrupt records never grant access or get overwritten. No health data or account
identity is stored in this record. This is local to each device; it is not a
server-enforced, account-wide promotion, and a new device has its own grant.
Keychain persistence normally survives reinstall on the same device, but is
not a cross-device restore guarantee. Device erasure can remove this record.

The gift requires no purchase, payment method or subscription and cannot charge
or renew. The welcome message and plan screen show that fact and the plan screen
shows its end date. Verified paid access takes priority. An existing paid
subscription continues under its own billing terms; the gift does not cancel,
refund or extend it. After expiry, foreground/export/request/background checks
use the existing Free policy, keeping saved selections and uploaded data.

Release acceptance still needs a physical-device check of an actual pre-Pro
App Store download versus a fresh download, first foreground activation,
offline relaunch, deadline expiry, and paid-subscription priority. Document the
gift in App Review notes; no App Store Connect subscription offer is needed.
