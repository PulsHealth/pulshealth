# PulsHealth Pro subscription setup

Source implementation for issue #251. This document is preparation, not proof
that products exist in App Store Connect or that a subscription is released.

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

- [ ] Create both products in App Store Connect; configure territories, tax
      category, localizations, subscription review screenshots and descriptions.
- [ ] Confirm the Paid Apps Agreement, tax and banking readiness.
- [ ] Set US base prices above; confirm each localized product is returned by
      StoreKit on a sandbox physical device.
- [ ] Verify purchase, restore on a fresh install, cancellation retaining access
      through the paid period, expiration, refund/revocation, Ask to Buy, billing
      grace, offline launch and app relaunch for both durations.
- [ ] Verify five versus six types, raw/aggregate deduplication, recent dates
      versus old custom ranges, all file formats and Data Request delivery.
- [ ] Verify background/observer/continued sync after expiry, preserving existing
      uploads, and historical backfill resumption after purchasing or restoring.
- [x] Maintainer approved the transition on 2026-10-15: existing users receive
      the new Free limits. There is no legacy entitlement or grandfathering.
- [ ] Update store description, review notes, privacy answers and screenshots.
      Deploy the updated privacy policy before submitting.
- [ ] Submit the first subscription group with a subscription attached to the
      app version, then verify approval and public availability separately.

`PulsHealth/Configuration/Pro.storekit` supplies the two prices for local StoreKit
tests. It is bundled only with hosted tests and selected by the Debug Run scheme
for local purchases. It does not create production products. Disable the local
StoreKit configuration when checking real App Store Connect products on a
sandbox device; archives never use this local configuration.

The paywall lives at Settings → Plan and at upgrade prompts. It offers Restore
Purchases, Apple's subscription-management page, the privacy policy and Apple's
standard EULA. Unavailable products leave Free access usable and show retry copy;
unverified and pending transactions do not unlock Pro.
