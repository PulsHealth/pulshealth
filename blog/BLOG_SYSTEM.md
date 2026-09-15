# Adding a post

Posts are MDX files in `blog/articles/`; the site lists them at
[pulshealth.com/blog](https://pulshealth.com/blog/) and in `/feed.xml`. The
file name is the URL: `blog/articles/my-post.mdx` → `/blog/my-post/`.

## Frontmatter

```yaml
---
title: "Apple Watch HRV: What It Means and How It's Measured"
date: "2026-02-03"                       # ISO date; the list is sorted by it, newest first
tags: ["hrv", "apple-watch"]             # shown as badges, fed to search and the RSS feed
excerpt: "One or two sentences."         # list page, <meta description>, feed, Open Graph
author: "Sean Wade"                      # optional; shown on the post and in JSON-LD
featured_image: "https://pulshealth.com/blog/my-post/hero.webp"  # optional; absolute URL, 1200×600, Open Graph card
---
```

`title` is required (a file without one is skipped). Reading time is computed
from the body at 220 words per minute.

## Components

Besides plain Markdown (GFM tables, fenced code with syntax highlighting),
these are available in every post. They are defined in
`site/src/components/mdx-components.tsx`; add one there and here together.

- `<Callout type="info|warning|success|tip" title="…" icon={true}>`: highlighted aside. `type` defaults to `info`.
- `<KeyTakeaways title="Key Takeaways">`: summary box; put a Markdown bullet list inside, with a blank line after the opening tag.
- `<Definition term="Heart Rate Variability">…</Definition>`: inline term with the definition in a hover tooltip.
- `<DataTypeLink identifier="HKQuantityTypeIdentifierHeartRateVariabilitySDNN">Heart Rate Variability</DataTypeLink>`: link to a knowledge-base type page; the child text is optional (defaults to the identifier minus its `HK…TypeIdentifier` prefix).
- `<BlogImage src="/blog/my-post/figure.webp" alt="…" caption="…" width={1920} height={1080} priority />`: figure with caption. `width`/`height` are the file's pixel size (default 800×600); `priority` only on the first image above the fold.

## Images

Put them in `blog/images/<slug>/` and reference them as
`/blog/<slug>/file.webp`. `site/package.json`'s `copy-blog-images` script
copies that directory into `site/public/blog/` before `dev` and `build`.
Prefer WebP, no wider than 1920 px.

## Checking it

```bash
cd site && bun install && bun run lint && bun run build
```

The build exports one directory per article under `site/out/blog/`, and CI
asserts that count equals the number of tracked `blog/articles/*.mdx` files.
Both files are read by relative path from `site/` (`../blog/articles`,
`../blog/images`), so moving `blog/` silently exports fewer pages; the count
check is what catches it.
