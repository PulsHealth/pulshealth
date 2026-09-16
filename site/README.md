# pulshealth.com — marketing site

Next.js (App Router, static export) site for pulshealth.com: the product
pages, the blog, the HealthKit knowledge-base viewer, and the project
documentation rendered from the repository. It is a separate thing from
[`web/`](../web/README.md), which is the self-hosted viewer that reads your
own Postgres.

It reads content from **three places in the repository**, by relative path
from `site/`, so none of them can move:

| Source | Read by | How |
|---|---|---|
| [`../knowledge-base/`](../knowledge-base/README.md) | `src/lib/api.ts` | `path.join(process.cwd(), "..", "knowledge-base")` — 177 YAML type files become `/knowledge-base/types/<slug>/` |
| [`../blog/`](../blog/BLOG_SYSTEM.md) | `src/lib/blog.ts`, `package.json` | `../blog/articles/*.mdx` become `/blog/<slug>/`; `copy-blog-images` copies `../blog/images` into `public/blog/` before every dev run and build |
| Five markdown files: [`../docs/protocol/README.md`](../docs/protocol/README.md), [`../server/README.md`](../server/README.md), [`../docs/ai.md`](../docs/ai.md), [`../docs/export.md`](../docs/export.md), [`../docs/database-guide.md`](../docs/database-guide.md) | `src/lib/docs.ts` | An explicit, ordered manifest (`DOCS`) — not a glob — becomes `/docs/` and `/docs/<slug>/`. Rendered as plain markdown (GFM, highlighted code, GitHub-style heading ids so the spec's own anchors work) with relative links rewritten: a link to another manifest file becomes its site route, anything else relative points at the file on GitHub at `main`. The markdown is never edited for the site; add a page by adding a manifest entry and bumping `manifest=5` in the `site` CI job |

Moving `site/` (or any source) breaks the loaders without a build error —
they log "not found" and simply emit fewer pages. The page count is the
tell: a full build exports **198** static pages, 177 of them under
`knowledge-base/types/` and 6 under `docs/`.

## Develop

```bash
cd site
bun install
bun run dev        # localhost:3000
```

## Build and lint

```bash
bun run build      # static export to site/out/ (198 pages)
bun run lint       # ESLint (2 known warnings, no errors)
```

`make site-dev`, `make site-build` and `make site-lint` from the repository
root do the same.

## Deploy

```bash
scripts/deploy-site.sh    # or: make deploy-site
```

Builds, syncs `out/` to the `pulshealth.com` S3 bucket and invalidates the
CloudFront distribution. Needs AWS credentials with rights to both; run it
from anywhere, it locates the repository itself.

## Configuration

`.env.production` carries the two public build-time values (the form
endpoint and the GA measurement ID) and is tracked, since a static export
bakes them into the HTML anyway. `.env.example` documents them for a local
`.env.local`.
