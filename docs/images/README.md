# Product image provenance

Reviewed October 25, 2026. These product captures use synthetic data or an
empty simulator. Published research figures in the blog have their own methods
and may describe the author's explicitly disclosed historical records.

| Assets | Source | Capture and scope |
|---|---|---|
| `app/unlock.png`, `app/explore.png`, `app/type-page.png`, `app/export.png` | App source at `2967a937f8448e9093b65cdac6155d7ffd9671e0` (2.3, build 30) | October 24, 2026; iPhone 17 Pro Max simulator, iOS 26.5, dark appearance. Explore uses `PulsFixtureProfiles`; Export shows default controls, not a successful export. These are source-build captures, not evidence of App Store approval. |
| `web/today.png`, `web/workouts.png` | Public `https://app.pulshealth.com/demo` in a fresh browser context | October 24, 2026; 1440 × 1000, dark appearance. Confirmed “Demo account” and “Demo data” before capture. The deployed source revision is not asserted. |
| `server/grafana-health.png` | Reference stack's provisioned dashboard with synthetic ingest batches | Earlier capture retained after checking panel definitions. It is separate from the downloadable blog starter dashboard; dates and values are example data. |

The app PNGs are resized to 600 × 1304. The same captures supply the WebP
copies under `site/public/screenshots/`, and the Export and desktop-viewer
articles under `blog/images/`. `app-export-2.1.png` keeps its historical URL for
existing references but now contains the current Export builder.

To refresh the app, build the current source using the local ignored signing
configuration. Use a dedicated simulator and the documented DEBUG launch
arguments in `RootView.swift` and `ExploreFixtures.swift`: `-PulsFixtureProfiles 1`,
`-PulsInitialTab explore|export`, and `-PulsInitialType HKQuantityTypeIdentifierHeartRate`.
Capture the first onboarding page on a fresh install. Never use a personal
HealthKit store or authenticated personal viewer session for product captures.

Refresh all copies together, preserve their aspect ratios, and update article
captions and revision dates when materially changing their content. Run
`make blog-check` to validate image references, local links, feeds, search,
sitemap entries, and the exported site. A screenshot validates appearance;
it does not establish background delivery, data completeness, or a release.

## README overview

`overview/data-flow.svg` is the editable source for the README opening visual;
`overview/data-flow.png` is its raster rendering for GitHub. It follows the
website hero: the app can export files or sync to a database you control. The
phone uses the synthetic `app/explore.png` capture documented above; the file
and database artwork is illustrative, with no personal health records.

After editing the SVG, re-render the PNG with CairoSVG (requires Cairo) and
inspect the result:

```bash
uv run --with cairosvg --with pillow python -c "import cairosvg; cairosvg.svg2png(url='docs/images/overview/data-flow.svg', write_to='docs/images/overview/data-flow.png')"
```
