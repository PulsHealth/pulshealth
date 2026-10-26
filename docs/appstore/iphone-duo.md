# iPhone Duo

The 2.4 (31) source candidate uses adaptive Explore navigation. This document
is preparation, not proof of upload, submission, approval, or a live badge.

Build the release with Xcode 27.1 or later. Explore keeps its selected type
while the split view adapts between catalog/detail columns and compact
navigation. Changing types resets pushed detail pages.

## Acceptance

Use a dedicated Duo simulator on iOS 27.1. Verify both displays and resize
mid-session: onboarding (including its Health page), type selection and Back,
a populated analysis and its pushed pages, export options and share popover,
database setup, and the Apply/Discard bar. Preserve the selected type, export
options, and pending sync edits. Also check larger text and ordinary iPhone
and iPad navigation. Simulator checks do not establish physical HealthKit or
background delivery behavior.

## Screenshots and badge

Capture genuine app screens with synthetic Explore fixtures
(`-PulsFixtureProfiles 1` in a Debug build), never personal health data.
Apple accepts outer-display images at 1398 × 2034 (or landscape reversed),
and inner-display images at 2007 × 2853 (or reversed). Use PNG or JPEG without
transparency. Keep original captures and checksums with private release evidence.

Upload and submit the verified Duo assets through App Store Connect, assign
them to the matching product-page version, and verify the published result
after Apple approval. Uploading an asset alone is not a live badge.

Sources: [Apple preparation guide](https://developer.apple.com/iphone-duo/prepare/)
and [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
