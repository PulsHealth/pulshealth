# pulshealth.com — marketing site

Next.js (App Router, static export) site for pulshealth.com: the product
pages, the blog, and the HealthKit knowledge-base viewer. It is a separate
thing from [`web/`](../web/README.md), which is the self-hosted viewer that
reads your own Postgres.

The desktop and mobile navigation list Dashboard (the hosted viewer at
app.pulshealth.com), Knowledge Base, Docs, and Consulting in that order.
Sign-in lives in the dashboard demo banner rather than the public navigation.
Blog remains linked from the footer. The navbar uses a centered 1280 px content row, 72 px high on desktop and
64 px on phones, with 32 px desktop / 24 px mobile edge padding (20 px on narrow phones), matching the dashboard. Both switch to a dropdown
below 1024 px; the dashboard adds its health/account options above the public links.

Page heroes begin with the title and description, without a page-label pill.

The homepage sync section includes self-hosted setup guidance and a copyable
starting prompt linking to `/llms.txt`, so visitors can follow the Docker setup
guide themselves or ask a coding assistant for help. Setup is described as
assistance rather than a guaranteed one-prompt deployment. The hero links to
the guide for connecting a compatible AI assistant through the database.

The homepage leads with “Unlock your health data” and explains the promise as
“Sync, export, and control your Apple Health data.” An animated diagram separates
background sync to your database (and its dashboard/API/AI tools) from direct CSV
and JSON exports. Motion pauses offscreen and respects reduced motion. Mobile uses a separate
vertical flow layout without overlapping artwork. The hero centers a real app screenshot between a CSV preview and a database illustration, with animated data streams.
The web section uses an interactive, simplified dashboard and an API example,
with a short iPhone-to-database-to-browser animation, followed by
“Control your own health data” and the copyable AI setup prompt. Detailed export,
exploration, aggregation, and sync information lives at `/features/`.
Keep the headline vocabulary consistent with the App Store copy, About page,
footer, and search metadata. Local exploration and exports need no account;
database sync needs a compatible destination; AI tools connect through the database.
Hosted account calls to action say “Request” because access requires approval.

Subscription details stay out of the primary navigation; the footer links to
Pro and `/pricing/`. These two compact
pages explain full available history, all supported sync types, and the Free
limits. Prices follow `docs/appstore/subscriptions.md`; the app displays Apple’s
localized price. Hosting is separate, and the database remains open source and
free to run yourself. Keep the shared home/support FAQ aligned with these plans.

The entire site, including blog articles, is always dark with no theme selector.
It shares the homepage's navy surfaces, blue accents and Geist typography with
the web viewer. Earlier saved light-mode preferences do not change the theme.

It reads content from the **repository around it**, by relative path, so
`site/` and the things it reads must stay where they are:

| Source | Read by | How |
|---|---|---|
| [`../knowledge-base/`](../knowledge-base/README.md) | `src/lib/api.ts` | `path.join(process.cwd(), "..", "knowledge-base")` — 178 YAML type files become `/knowledge-base/types/<slug>/` |
| [`../blog/`](../blog/BLOG_SYSTEM.md) | `src/lib/blog.ts`, `package.json` | published `../blog/articles/*.{md,mdx}` become `/blog/<slug>/`; image sync recreates `public/blog/` from published posts, and preview watches drafts and images |
| [`../llms.txt`](../llms.txt) | `scripts/gen-llms-txt.ts`, `package.json` | `gen-llms-txt` renders it to `public/llms.txt` before every dev run and build, so the site serves it at `/llms.txt`. Its repo-relative Markdown links are rewritten the way links inside a rendered document are: to `https://pulshealth.com/docs/<slug>/` for a file in the docs manifest below, otherwise to the file on GitHub; absolute URLs pass through. The same generator publishes each Markdown doc at `/docs/<slug>.md` and combines them in `/llms-full.txt`, from the docs manifest. Outputs are gitignored; edit the repository sources. The export checker verifies every copy against its source |
| The Markdown documents registered in `src/lib/docs.ts`, starting with [`../docs/setup.md`](../docs/setup.md); `docs/privacy-policy.md` is rendered separately at `/privacy` | `src/lib/docs.ts` (the registry), `src/lib/markdown.tsx` (the renderer) | Each registered document becomes `/docs/<slug>/`, rendered at build time from its source. Relative links resolve to other rendered documents where available, otherwise to GitHub |
| [`../server/api/openapi.json`](../server/api/openapi.json) | `src/lib/openapi.ts`, `src/components/api-reference.tsx`, `scripts/gen-openapi.ts` | The product API's OpenAPI document, the same file the Go service embeds. Its manifest entry carries `format: "openapi"`, so `/docs/api-reference/` renders it as an endpoint reference rather than as Markdown. `gen-openapi` also copies it to `public/openapi.json` (gitignored) before every dev run and build, with the server URL set to the API's default local address, for the reference's download link |

`site/` must stay beside its content sources. Missing or malformed blog
content fails with its filename. The shared `scripts/check-export.ts` runs
after every build, in CI, and before deployment (even with `--skip-build`).
It checks exact published blog/knowledge-base/docs pages, draft exclusion,
RSS/search/sitemap entries, article links/images and required generated assets.
Expected page counts come from the knowledge-base sources, published posts and
`DOCS` registry, so adding a guide updates the checks without a hand-maintained total.

The export gate also checks every public sitemap entry for a matching canonical,
unique title, indexable HTML, an incoming internal link and working local links.
The retired Toothbrushing identifier redirects to the current ToothbrushingEvent
page and stays outside the sitemap. Search Console can retain old exclusions
until Google recrawls; passing these checks makes pages eligible, but does not
guarantee Google will index them.

Friend Flex is a separate app by the same developer. Its product page at
`/friend-flex/` uses genuine demo screenshots to explain challenges, improvement
scoring, iMessage and optional Apple Health. Help lives at `/friend-flex/support/`
and its privacy policy is `/friend-flex/privacy/`, rendered from
`content/friend-flex/privacy-policy.md`. The footer, search and sitemap use
these canonical URLs. Legacy `/fun100/` URLs redirect to the new pages.

The footer groups links under PulsHealth, Resources, Developers and More apps,
with legal links in a separate bottom row. Pricing links to the Free/Pro comparison.

Watch Workout Pro is a separate native iPhone app with its own public landing
page at `/watch-workout-pro/`, support at `/watch-workout-pro/support/`, and
privacy at `/watch-workout-pro/privacy/`. Support uses `support@pulshealth.com`.
These pages are included in search and the sitemap; the footer links to the
product. Both `/watchworkoutpro/` and `/workout-to-watch/` (including their
support/privacy routes) retain noindex redirect stubs with destination canonicals.
Product policy content lives in `content/watchworkoutpro/`. Marketing screenshots
are resized from the app's approved dark source captures. App Store availability
must be verified before replacing the launch notice with a download action.

## Sharing preview

The default sharing card uses the website's navy card color (`#111b28`), the
PulsHealth logo/name, and “Export and sync your health data” on one line.
Homepage Open Graph and X titles use the same wording. The card has no domain
or trailing period. Blog featured images and other products keep their own previews.

Regenerate `public/og-pulshealth-navy.png` and its legacy image copies with
`bun scripts/gen-social-card.tsx` from `site/`. The generator uses macOS-supplied
Arial; on other systems, set `SOCIAL_CARD_FONT_DIR` to a licensed installation
containing `Arial.ttf` and `Arial Bold.ttf`. Fonts are not redistributed.
The new image URL allows sharing services to fetch the selected artwork;
existing Messages or social cards can remain cached by their apps.

## Develop

```bash
cd site
bun install
bun run dev        # localhost:3000
```

## Build and lint

Styles remain separately cacheable assets, and both text fonts are preloaded.
Global CSS inlining was measured against the production export: it increased
compressed homepage HTML from about 18 KB to 91 KB for only a small mobile
LCP change (3.2 s to 3.0 s). The experiment, which also deferred the monospace
font, showed layout shifts. Reconsider these choices only with measurements across both landing
pages and documentation, including transfer size and layout stability.

Build verification requires `python3` (3.9 or later) and Git as well as Bun.
Build from a Git checkout so the export can be tied to its source inputs.

```bash
bun run build      # static export to site/out/; checks counts against source
bun run lint       # ESLint, no warnings or errors
bun run test       # blog regression tests
bun run blog:check # lint, tests, build and export checks
```

`make site-dev`, `make site-build` and `make site-lint` from the repository
root do the same. `make blog-check` runs the complete authoring check.
The [writing guide](../blog/BLOG_SYSTEM.md) covers drafts, a post template,
ideas, sources and publishing.

## Deploy

```bash
scripts/deploy-site.sh    # or: make deploy-site
```

Builds, syncs `out/` to the `pulshealth.com` S3 bucket and invalidates the
CloudFront distribution. Needs AWS credentials with rights to both; run it
from anywhere, it locates the repository itself.

## Configuration

Retired URLs with replacement content have redirect stubs under `public/`
(including `/ai/`, `/privacy-protect/`, `/docs/self-hosting/` and `/license/`).
These use an immediate meta refresh, a destination canonical and `noindex`,
the same convention as `/app/`, `/ios/`, `/sync/` and `/terms/`. They stay out
of the sitemap; Search Console exclusions for these stubs and the private
`app.pulshealth.com` viewer are intentional.
Related metrics on a type page link only to types with a knowledge-base
page; other related concepts remain visible as text cards.

`.env.production` carries public build-time values for the form endpoint and
optional self-hosted aggregate collector URL/site ID. They are tracked because
the static export publishes them; never put analytics API keys here.
`.env.example` documents local configuration. Unset both analytics values
to disable collection. The tracker runs only on the production marketing
hostname, respects Do Not Track/Global Privacy Control, excludes URL query
strings/fragments, referrer paths, titles, form values and identity data,
and sends only fixed page groups, source categories, action names, App Store button placements and Web Vitals rating buckets. No visitor/session IDs or raw URLs/timing values are sent or stored. Counters are UTC daily sums in Observatory, not Umami event records.
`form-dialog` distinguishes attempts, success and errors without sending
the contents. App Store clicks indicate intent, not installations. No
analytics cookies, replay, heatmaps or health-viewer tracking are enabled.
Optional audience requests abort after five seconds and are never retried:
an unknown delivery outcome must not create a duplicate counter increment.
Keep this aligned with the website section of `docs/privacy-policy.md` and
the `/privacy` summary. The native app's analytics-free claims still apply.

Every HealthKit type page links to the recording guide. Six pilot entries render
their optional structured `recording_behavior` guidance with a separate review
date and primary-source links. Content validation runs in CI independently of
the app's compact generated resource; a recording review is not a clinical
review of every other field.

### Build provenance and deployment completion

`bun run build` binds the export to its source inputs and hashes every output
file in the ignored `.puls-build.json`. The deployment helper requires a clean
checkout and rejects missing/stale manifests and modified output, including with
`--skip-build`. It waits for CDN invalidation and compares live pages/assets with
the build. Add `--verify-path blog/<slug>/index.html` for changed routes.
Use the same `NEXT_PUBLIC_*` environment overrides when building and deploying;
explicit `bun --env-file` injection must also be reproduced for validation.
A private receipt records the source, build fingerprint, invalidation and checked
files. `--no-invalidation` deliberately leaves status `uploaded-unverified`.
See [CONTRIBUTING.md](../CONTRIBUTING.md#task-status-and-release-evidence).

## Researched knowledge-base examples

The five initial researched entries carry optional `data_research` completion
metadata and source-authored `figures`. Completion is tracked in the source
metadata. Type pages render question-led prose, stable section
anchors, desktop/mobile contents navigation, static figures with captions and
methods, full-size image links, and optional technical details. Research dates
are distinct from article update dates and do not imply clinical certification.

Figure placement uses the exact article H2 in `figures[].section`; unmatched
figures follow the article. Actual image dimensions preserve their aspect ratio.
Public charts use relative dates or elapsed time and explain selection, units,
coverage, weighting and the limits of example user data. Raw exports, executed
notebooks and private HTML reports stay outside the site and public repository;
see `../notebooks/healthkit-research/README.md` for the reproducible workflow.

## Ad destinations and legacy campaign redirects

All new ads should link directly to **https://pulshealth.com/**. Visitors see
the normal homepage and its normal App Store links. There are no separate ad
landing pages or campaign-specific changes to the homepage.

`content/campaigns.json` is a public snapshot exported from the private
Observatory campaign registry. Keep its historical IDs and paths so existing
links continue to resolve; its old copy is not rendered. Refresh the snapshot
with Observatory's `scripts/export-campaigns.mjs`, never private experiment
data, spend or keys.

`/go/[campaign]/` retains registered old links as immediate homepage redirects,
with a homepage canonical and noindex. No campaign is persisted or carried
to the App Store.

Homepage statistics count page groups, broad source categories and fixed actions,
respecting DNT/GPC. Query parameters remain discarded. Overall homepage traffic
cannot be assigned to individual ads or creative variants. Ad-platform clicks,
website visits, App Store clicks, Apple downloads and Apple purchases remain
separate measures; historical campaign reports must not be presented as
attribution for these untagged homepage visits. Observatory owns spend imports,
historical Apple campaign reports, scenarios and private reporting; no app
release is needed.

The export checker validates every legacy redirect, homepage canonical,
noindex, and removal of campaign content and Apple campaign tags. Future
registry exports must preserve existing redirect IDs rather than reintroduce
landing pages.

### Search discovery and cache policy

Search crawlers and user-directed AI retrieval can read all public pages. Separate
training/reuse agents retain their knowledge-base restriction in `robots.ts`.
`llms.txt` is a convenience index, not a substitute for crawlable HTML, internal
links, or search-engine indexing. Product pages share the `#app` entity; do not
add invented ratings to qualify for a software-app rich result.

The sitemap uses authored revision dates for blog/knowledge pages and Git content
history for static/documentation pages. Dirty or shallow sources omit Git-derived
dates. Production builds therefore need complete history and a clean commit;
the artifact fingerprint includes Git state as well as content.

Deployment uploads hashed assets first, mutable media second, and documents last.
It refreshes Cache-Control even for unchanged bytes: one year immutable for
`_next/static`, one day for replaceable images/fonts, and revalidation for HTML
and discovery documents. Old hashed assets remain available for open tabs; any
separate bucket cleanup must retain assets referenced by still-served releases.
Live release verification checks both bytes and cache headers.

### Edge redirects

The build generates `out/_edge/router.js` from the actual exported routes and
legacy meta-refresh pages. It combines host, legacy-path and trailing-slash
redirects into one HTTP 301, preserves query parameters, and leaves unknown
paths alone. The HTML stubs remain useful when previewing without CloudFront.
The generated function must stay below CloudFront's 10 KB limit; the build fails
if it grows too large.

Publishing an export to S3 does **not** publish a CloudFront Function. When
releasing a route change, also publish this exact generated artifact to the
existing viewer-request function associated with the site's default behavior:

1. Read the live distribution/function configuration. Preserve other behaviors
   (including `/r/*`), runtime and associations. Back up LIVE and DEVELOPMENT
   code/configuration outside the repository. Stop if DEVELOPMENT contains an
   unrelated unpublished change.
2. Update DEVELOPMENT with `aws cloudfront update-function --name <function>
   --if-match <current-etag> --function-config file://<saved-config>
   --function-code fileb://<export>/_edge/router.js`.
3. Use `aws cloudfront test-function` against DEVELOPMENT before publishing.
   Check a legacy path, a slashless document, www plus a legacy path, repeated
   query parameters, and a nonexistent path. `site/tests/edge-router.test.ts`
   provides the expected behavior. A function error is a release failure.
4. Publish using `aws cloudfront publish-function --name <function> --if-match
   <updated-etag>`. Read LIVE back and compare its bytes with the tested artifact.
5. Verify actual HTTP responses after propagation: `/app/` → `/`, `/sync/` →
   `/server/`, `/docs/database` → `/docs/database/`, no extra hop from www, and a
   unique nonexistent URL still returns 404. Save the source SHA, function ETag,
   test results and HTTP evidence with the private deployment receipt.

Review Search Console and Bing after a release. A successful live URL test,
sitemap fetch or indexing request is not proof of indexing or AI recommendation.

## IndexNow publication notifications

After CDN completion and live-byte verification, `scripts/deploy-site.sh`
notifies [IndexNow](https://www.indexnow.org/documentation) of added, changed
and removed canonical sitemap URLs. The public `indexnow-key.txt` file proves
domain control; it is deliberately public, not a private API credential.
Only public URLs are sent from the deployment machine. Visitors make no
additional requests and no visitor data is collected.

Change detection hashes main-page text, links, image references, search metadata
and JSON-LD. It ignores CSS, JavaScript build identifiers, animation SVGs and
repeated header/footer chrome, so rebuilding identical content does not notify
all pages again. Removing a URL from the sitemap also sends that old URL.

The publishing clone stores fingerprints under Git's private
`pulshealth/indexnow/state.json`, shared across its worktrees. Preserve this file
when moving the publishing clone. The first deployment without state only
initializes a baseline. Use `--indexnow-bootstrap` once for a new launch or
recent site-wide content update to explicitly submit the current public URLs;
never use it to backfill old unchanged content. A per-clone publication lock
prevents overlapping uploads and notification-state writes. Publish from one
clone; this is not a cross-machine deployment lock.

Dry runs, failed verification and `--no-invalidation` never notify IndexNow.
Each deployment receipt records notification status separately from site
verification. HTTP 200 means accepted; 202 means received pending verification;
neither proves indexing or an AI recommendation. Failed submissions preserve
previous fingerprints and retry after the next verified deployment (including
an unchanged republish); no tight automatic retry loop is used. Each accepted batch is checkpointed; a later deployment retries unacknowledged
changes. A failed state write may repeat a previously accepted batch.

## Interactive examples

`/examples/` showcases four projects, with detail routes generated from
`src/lib/examples.ts`. Default demos use reviewed recorded summaries and normalized route paths in
`src/lib/example-recorded.json`. Raw source records stay private. Generated data
from `src/lib/example-data.ts` is optional; user-selected showcase JSON is held
only in memory.
No health file upload, browser persistence, map provider or AI request is made.
The local CSV/JSONL adapter and route SQL live in `../examples/showcase/`.
The examples lead with clickable previews and titles; AI briefs are collapsed. Distances default to miles.
Discovery links live in the footer, homepage and docs landing page, outside the top navigation.
Share images contain no personal attribution. The year report includes optional
daily health summaries, and the route tools support interactive styling and exploration.
