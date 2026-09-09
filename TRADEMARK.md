# Trademark policy

The source code in this repository is licensed under the Apache License 2.0
(see `LICENSE`). Section 6 of that license makes explicit that the license
**does not** grant permission to use the licensor's trade names, trademarks,
service marks, or product names, "except as required for reasonable and
customary use in describing the origin of the Work and reproducing the content
of the NOTICE file." This document says what that means for this project.

## What is reserved

The following are reserved to the project maintainer (the copyright holder
named in `NOTICE`) and are not covered by the code license:

- the name **PulsHealth**, alone or combined with other words, as the name of
  an app, service, package, website, or organisation;
- the PulsHealth app icon and logo, and any confusingly similar mark;
- the PulsHealth App Store listing
  ([id6757657354](https://apps.apple.com/us/app/pulshealth/id6757657354)) and
  any TestFlight listing, which only the maintainer publishes.

## Forks and redistributed builds

You may fork, modify, build, and distribute this software under the Apache
License 2.0. If you distribute a build — on the App Store, TestFlight, an
enterprise or ad-hoc channel, or as a binary download — it must:

- ship under a **different name** and a **different icon**, so nobody mistakes
  it for the official app;
- use a **different bundle identifier** (change `bundleIdPrefix` in
  `PulsHealth/project.yml`; the official app on the App Store is
  `com.pulsHealth.PulsHealth`, and the `com.puls` prefix in this repository is
  reserved to it as well);
- not describe itself as the official or endorsed PulsHealth app.

Building the unmodified source yourself and installing it on your own devices
is not distribution; you may do that under the original name.

## Nominative use is welcome

You do not need permission to refer to the project by name in order to
describe your own work truthfully. For example:

- "works with PulsHealth", "compatible with PulsHealth", "a receiver for
  PulsHealth";
- "implements the Puls Sync Protocol";
- "a fork of PulsHealth" or "based on PulsHealth" in a README, changelog, or
  about screen;
- blog posts, talks, tutorials, package descriptions, and comparisons.

Such references must not suggest that the maintainer produced, endorsed, or
supports your work.

## The protocol name

**Puls Sync Protocol** names the wire contract between the app and a backend.
Compatible implementations — receivers, alternative clients, libraries,
conformance tools — may use that name freely to say what they implement,
including in a product name (for example "Foo, a Puls Sync Protocol
receiver"), provided they actually implement the protocol as specified and do
not claim to be the official implementation.

## Questions

If a use is not clearly covered here, open a GitHub issue describing it. The
intent is to keep the official app unambiguous, not to restrict people who
build on the project.
