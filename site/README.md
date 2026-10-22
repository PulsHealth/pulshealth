# pulshealth.com — marketing site

Next.js (App Router, static export) site for pulshealth.com: the product
pages, the blog, and the HealthKit knowledge-base viewer. It is a separate
thing from [`web/`](../web/README.md), which is the self-hosted viewer that
reads your own Postgres.

The desktop and mobile navigation list Dashboard (the hosted viewer at
app.pulshealth.com), Knowledge Base, Docs, and Consulting in that order.
Sign-in lives in the dashboard demo banner rather than the public navigation.
Blog remains linked from the footer. The navbar spans the viewport with a 56 px
row and 32 px desktop / 24 px mobile edge padding (20 px on narrow phones), matching the dashboard. Both switch to a dropdown
below 1024 px; the dashboard adds its health/account options above the public links.

Page heroes begin with the title and description, without a page-label pill.

The homepage sync section includes self-hosted setup guidance and a copyable
starting prompt linking to `/llms.txt`, so visitors can follow the Docker setup
guide themselves or ask a coding assistant for help. Setup is described as
assistance rather than a guaranteed one-prompt deployment. The separate AI
section shows data exploration with a compatible assistant.

The homepage leads with “Unlock your health data” and explains the promise as
“Sync, export, and control your Apple Health data.” Its feature sequence is
the web app, sync, export, data types/custom summaries, AI, then control.
The web app has a prominent demo action and an accessible screenshot switcher
for the Today dashboard and workout history. Keep this vocabulary
consistent with the App Store copy in `docs/appstore/2.1-copy.md`, the About page,
footer, and search metadata. Local exploration and exports need no account;
database sync needs a compatible destination; AI tools connect through the
database. Hosted account calls to action say “Request” because access requires
approval. The pale blue, mint, and lilac product illustrations echo the approved
Style A campaign while preserving the site's dark shell. Regenerate the tracked
social sharing card with `cd site && bun scripts/gen-social-card.tsx` when that
message changes.

Subscription details stay out of the primary navigation; the footer links to
Pro and `/pricing/`. These two compact
pages explain full available history, all supported sync types, and the Free
limits. Prices follow `docs/appstore/subscriptions.md`; the app displays Apple’s
localized price. Hosting is separate, and the database remains open source and
free to run yourself. Keep the shared home/support FAQ aligned with these plans.

The main site is always dark and has no theme selector. Blog articles retain
a light/dark toggle, default to dark, and save their choice separately in
`pulshealth-blog-theme`; neither follows the system theme. The app's theme
controls are independent.

It reads content from the **repository around it**, by relative path, so
`site/` and the things it reads must stay where they are:

| Source | Read by | How |
|---|---|---|
| [`../knowledge-base/`](../knowledge-base/README.md) | `src/lib/api.ts` | `path.join(process.cwd(), "..", "knowledge-base")` — 178 YAML type files become `/knowledge-base/types/<slug>/` |
| [`../blog/`](../blog/BLOG_SYSTEM.md) | `src/lib/blog.ts`, `package.json` | published `../blog/articles/*.{md,mdx}` become `/blog/<slug>/`; image sync recreates `public/blog/` from published posts, and preview watches drafts and images |
| [`../llms.txt`](../llms.txt) | `scripts/gen-llms-txt.ts`, `package.json` | `gen-llms-txt` renders it to `public/llms.txt` before every dev run and build, so the site serves it at `/llms.txt`. Its repo-relative Markdown links are rewritten the way links inside a rendered document are: to `https://pulshealth.com/docs/<slug>/` for a file in the docs manifest below, otherwise to the file on GitHub; absolute URLs pass through. The output is gitignored; the repository file is the only source |
| Thirteen Markdown documents: `docs/recording-behavior.md`, `server/README.md`, `docs/protocol/README.md`, `docs/database-guide.md`, `docs/api.md`, `docs/export.md`, `docs/ai.md`, `server/mcp/README.md`, `web/README.md`, `PulsHealthSync/README.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/roadmap.md` (and `docs/privacy-policy.md` for `/privacy`) | `src/lib/docs.ts` (the registry), `src/lib/markdown.tsx` (the renderer) | Each becomes `/docs/<slug>/`, rendered at build time from the file itself. Relative links inside a document resolve to the other rendered documents where there is one, otherwise to the file on GitHub |
| [`../server/api/openapi.json`](../server/api/openapi.json) | `src/lib/openapi.ts`, `src/components/api-reference.tsx`, `scripts/gen-openapi.ts` | The product API's OpenAPI document, the same file the Go service embeds. Its manifest entry carries `format: "openapi"`, so `/docs/api-reference/` renders it as an endpoint reference rather than as Markdown. `gen-openapi` also copies it to `public/openapi.json` (gitignored) before every dev run and build, with the server URL set to the API's default local address, for the reference's download link |

`site/` must stay beside its content sources. Missing or malformed blog
content fails with its filename. The shared `scripts/check-export.ts` runs
after every build, in CI, and before deployment (even with `--skip-build`).
It checks exact published blog/knowledge-base/docs pages, draft exclusion,
RSS/search/sitemap entries, article links/images and required generated assets.
A full build currently exports **226** static pages, 178 of them under
`knowledge-base/types/` and 13 under `docs/`; published posts add pages.

The export gate also checks every public sitemap entry for a matching canonical,
unique title, indexable HTML, an incoming internal link and working local links.
The retired Toothbrushing identifier redirects to the current ToothbrushingEvent
page and stays outside the sitemap. Search Console can retain old exclusions
until Google recrawls; passing these checks makes pages eligible, but does not
guarantee Google will index them.

Two of those pages are not PulsHealth: `/fun100/` and `/fun100/privacy/` are
the App Store support and privacy-policy URLs for Fun100, a separate app by
the same developer. They are unlisted (not in the navigation, search or
sitemap); the policy is `content/fun100/privacy-policy.md`, rendered the same
way as `/privacy`.

Watch Workout Pro is a separate native iPhone app with its own public landing
page at `/watch-workout-pro/`, support at `/watch-workout-pro/support/`, and
privacy at `/watch-workout-pro/privacy/`. Support uses `support@pulshealth.com`.
These pages are included in search and the sitemap; the footer links to the
product. Both `/watchworkoutpro/` and `/workout-to-watch/` (including their
support/privacy routes) retain noindex redirect stubs with destination canonicals.
Product policy content lives in `content/watchworkoutpro/`. Marketing screenshots
are resized from the app's approved dark source captures. App Store availability
must be verified before replacing the launch notice with a download action.

## Develop

```bash
cd site
bun install
bun run dev        # localhost:3000
```

## Build and lint

Build verification requires `python3` (3.9 or later) and Git as well as Bun.
Build from a Git checkout so the export can be tied to its source inputs.

```bash
bun run build      # static export to site/out/ (226 pages)
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
