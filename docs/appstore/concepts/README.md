# App Store 2.1 visual review

Open [`review.html`](review.html) directly in a browser. It is self-contained,
works offline, and makes no network requests. Review all three campaigns or
compare one card across styles. Click a card to enlarge it, choose a whole
style or individual cards, and download the review notes. Selections persist
in that browser when local storage is available.

Tracks [issue #206](https://github.com/PulsHealth/pulshealth/issues/206).

## Design directions

- **A / Clear blue:** bright product presentation, blue and pale health-category
  colors, large genuine app screenshots.
- **B / Data current:** dark navy, cyan data connections, floating UI and diagrams.
- **C / Full color:** larger geometric typography, blue, mint, amber, lilac and
  coral fields, strongly angled phone compositions.

All use the five-card sequence in [`../2.1-copy.md`](../2.1-copy.md), with
shortened supporting lines for visual clarity. Advertising cards have no
footnotes. Source/status notes belong to the review gallery, outside the cards.

## Sources and production status

The embedded app screens are the existing synthetic captures under
`site/public/screenshots/`. CSS/SVG compositions add illustrative health values,
database/file diagrams, aggregation controls, and an example AI question/chart.
They are style concepts, not newly captured 2.1 app UI or verified AI output.
The sync concept currently uses the real Explore screen as source imagery;
replace it with a fresh Sync capture when the direction is selected. The
aggregation graphic is an advertising illustration, not a replacement app UI.

## Selected production direction

Style A was selected for 2.1. Its top wordmark is removed and its file graphic
reads **JSON**. Production uses fresh 2.1 synthetic iPhone and iPad captures,
including the actual Sync and new Export screens. The portable gallery keeps
its existing embedded concept sources; production captures remain outside Git.

Build a private production page from `iphone/` and `ipad/` directories, each
containing `explore.png`, `sync.png`, `export.png`, and `type.png`:

```sh
python3 docs/appstore/concepts/build-review.py \
  --captures "$CAPTURES" --output "$ARTIFACTS/production.html"
```

Serve the output locally. `?capture=1` through `?capture=5` render only one
Style A card; append `&device=ipad` for tablet composition and source captures.
Capture Chrome at exactly 1320 × 2868 for iPhone and 2064 × 2752 for iPad.
Verify actual output dimensions, inspect every card, and retain SHA-256 hashes
with the private release artifacts. These are JPEG screenshots of HTML/SVG
compositions with embedded genuine app captures, not generated app UI.

See the [release record](../README.md#release-record) for delivery status.

## Editing and rebuilding

Edit `review.template.html`, then run:

```sh
python3 docs/appstore/concepts/build-review.py
```

Do not edit `review.html` directly; it is generated with embedded image assets.
The builder uses the Python standard library. The gallery has no third-party
JavaScript, fonts, analytics, or CDN dependencies.
