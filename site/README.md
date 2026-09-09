# pulshealth.com — marketing site

Next.js (App Router, static export) site for pulshealth.com: the product
pages, the blog, and the HealthKit knowledge-base viewer. It is a separate
thing from [`web/`](../web/README.md), which is the self-hosted viewer that
reads your own Postgres.

It reads content from two **sibling directories at the repository root**, by
relative path, so the three must stay where they are:

| Directory | Read by | How |
|---|---|---|
| [`../knowledge-base/`](../knowledge-base/README.md) | `src/lib/api.ts` | `path.join(process.cwd(), "..", "knowledge-base")` — 177 YAML type files become `/knowledge-base/types/<slug>/` |
| [`../blog/`](../blog/BLOG_SYSTEM.md) | `src/lib/blog.ts`, `package.json` | `../blog/articles/*.mdx` become `/blog/<slug>/`; `copy-blog-images` copies `../blog/images` into `public/blog/` before every dev run and build |

Moving `site/` (or either sibling) breaks both without a build error — the
loaders log "dir not found" and simply emit fewer pages. The page count is
the tell: a full build exports **190** static pages, 177 of them under
`knowledge-base/types/`.

## Develop

```bash
cd site
bun install
bun run dev        # localhost:3000
```

## Build and lint

```bash
bun run build      # static export to site/out/ (190 pages)
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
