# Writing and publishing

Keep ideas in [`ideas.md`](ideas.md). Posts are Markdown or MDX files in
`blog/articles/`; the filename is the permanent URL:
`my-post.mdx` → `/blog/my-post/`. Use lowercase names with hyphens.

## Start a draft

From the repository root:

```bash
cp blog/templates/post.mdx blog/articles/my-post.mdx
make site-dev
```

Open `http://localhost:3000/blog/`. Drafts appear first with a preview label.
Article and image edits refresh the preview without restarting the server.
Plain Markdown is enough; add components only when they help the explanation.

`draft: true` is available only in local development. Production excludes the
post, its image folder, and its search, feed and sitemap entries. Even local
search and feeds include only published posts. Draft files remain public in
this open-source repository: use a private location for confidential notes.
A draft needs a title; date and excerpt can wait. Metadata still has to parse.

## Metadata

```yaml
---
title: "A useful, specific title"
draft: true
# Set these when ready to publish:
# date: "2026-10-07"
# excerpt: "One or two sentences describing what the reader will learn."
tags: ["apple-health", "self-hosting"]
author: "Sean Wade"
# updated: "2026-10-08"
# featured_image: "/blog/my-post/hero.webp"
---
```

Published posts require a nonempty title, explicit quoted `YYYY-MM-DD` date,
excerpt and body. Dates must be real calendar dates; future dates are rejected
for published posts. There is no scheduled publishing: keep a future post as
a draft and publish it deliberately when ready. Missing dates never become
"today" automatically.

`tags` is an optional array of strings. `author` and `featured_image` are
optional. An image can use a site-relative path or absolute HTTP(S) URL.
Unknown fields, invalid types and duplicate slugs fail with the filename.
Both `.md` and `.mdx` are supported, but cannot share the same slug.
Reading time is computed at 220 words per minute.

For a material revision, set `updated` to its date, on or after the original
publication date. The original date and list order stay intact. The update
appears on the index and article, in social/structured metadata, the sitemap,
and the feed's build date. Explain substantial changes in the article too.

## A small writing routine

1. Capture the reader's question, your observation and supporting links in
   `ideas.md`. Work on one article at a time.
2. Draft the answer in your own words. An outline, figure or worked example
   can help; a fixed article structure is optional.
3. Link factual claims to supporting sources near the claim. Metrics articles
   need sources for numerical ranges, device behavior and health claims.
   Prefer original research and official documentation. A Sources section is
   optional; a generic disclaimer does not replace evidence.
4. For engineering posts, run the examples and link to the authoritative
   `/docs/` page for setup and reference material that changes over time.
5. Preview on desktop and mobile. Check tables, images, definitions and links.
   AI can help outline, edit and identify unsupported claims; review the prose,
   sources and results yourself before publication.
6. Add date and excerpt, remove `draft: true` (or set it to `false`), and run
   `make blog-check`. Use a focused, signed-off content commit/PR.
7. Deploy with `make deploy-site`. Verify the live article, image, `/feed.xml`
   and search entry. Deployment is a separate action from validation.
8. Complete the search discovery checks below and record the results in the
   release notes. Do not equate a successful deploy with Google indexing.

## Search discovery and indexing

Publishing automatically adds every non-draft article to `/blog/`,
`/sitemap.xml`, `/feed.xml` and site search. `robots.txt` advertises the sitemap.
The article template supplies canonical URLs and article metadata; the export
checker verifies published sitemap entries before deployment. No per-post
submission code or search-engine account belongs in the content files.

After each deployment:

1. Check each new or revised article at its public, trailing-slash URL after
   CDN invalidation completes: HTTP 200, a matching canonical, no unintended
   `noindex` in HTML or `X-Robots-Tag`, and no Googlebot block in `robots.txt`.
   Confirm it is linked from `/blog/` and present in the live sitemap and feed.
2. Check sitemap `lastmod` against the article's actual material revision date
   (`updated`, falling back to `date`). Preserve original publication dates on
   revisions; do not refresh dates just to suggest freshness. Older editorial
   dates do not mean Google discovered the page at that time.
3. Open the `pulshealth.com` property in
   [Google Search Console](https://search.google.com/search-console).
   Under **Sitemaps**, confirm `https://pulshealth.com/sitemap.xml` is registered
   and has no fetch/parse errors. Submit it if missing. An existing successful
   submission does not need resubmitting for each post: its URL stays fixed
   while the build updates its contents. Last-read and discovered-page counts
   can lag the deployment; record them as observed rather than declaring the
   new posts indexed.
4. For a few priority articles, use **URL inspection** to check Google's
   recorded status. If useful, run **Test live URL** and **Request indexing**
   once after the page passes. Use the sitemap for a batch; repeated requests
   do not speed crawling and are quota-limited. A successful live test or
   accepted request is not confirmation that the page is indexed.
5. Review **Page indexing** and **Performance**, filtered to `/blog/`, after
   one to two weeks and during subsequent editorial reviews. Record indexing
   status, impressions, queries and clicks. Investigate blocked, missing or
   incorrectly canonicalized pages. Treat “Discovered/Crawled - currently not
   indexed” as a status to investigate, not proof of a deployment defect.
   Improve usefulness and internal links where warranted; do not repeatedly
   resubmit unchanged pages.

Release notes should distinguish **live and discoverable**, **sitemap accepted**,
**indexing requested**, and **indexed**. If account access is unavailable, report
that limitation separately from the public URL checks. For Bing Webmaster
Tools, register the same sitemap when that property is configured; no separate
blog sitemap is needed. Do not add Google's deprecated sitemap-ping endpoint
or its restricted Indexing API to the blog deployment script.

Google says crawling can take days to weeks, and requests do not guarantee
indexing or rankings. See its official guidance on
[building and submitting sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
[requesting recrawls](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl),
and [the retired sitemap ping](https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping).

## Components

Markdown supports GFM tables and fenced code with syntax highlighting. These
optional components are defined in `site/src/components/mdx-components.tsx`:

- `<Callout type="info|warning|success|tip" title="…" icon={true}>`: highlighted aside; defaults to `info`.
- `<KeyTakeaways title="Key Takeaways">`: summary box. Use a blank line before a Markdown bullet list inside.
- `<Definition term="Heart Rate Variability">…</Definition>`: visible inline definition, readable on touch screens and with a keyboard.
- `<DataTypeLink identifier="HKQuantityTypeIdentifierHeartRateVariabilitySDNN">HRV</DataTypeLink>`: link to the knowledge-base type page. Child text is optional.
- `<BlogImage src="/blog/my-post/figure.webp" alt="…" caption="…" width="1920" height="1080" priority />`: captioned figure. Use quoted literal pixel dimensions (MDX expression props are disabled); figures include a full-size link and tall phone captures are width-limited; `priority` only on the first image above the fold.
- `<BlogFlow title="…" caption="Workflow diagram."><FlowRow label="Export" steps="Phone | CSV | Spreadsheet" note="Refresh the file for newer data." /></BlogFlow>`: a text-based figure for routes, choices, or checkpoints. Rows read left to right on desktop and top to bottom on mobile, with selectable text and both article themes supported. Label schematics clearly; do not present them as measured results or product screenshots.

Add new components to the implementation and this list together.

## Images

Put images in `blog/images/<slug>/` and reference them as
`/blog/<slug>/figure.webp`. Prefer WebP, no wider than 1920 px. A hero image is
optional; social sharing uses the default site image when none is specified.
Use roughly 1200×630 for a custom social card.

`site/public/blog/` is generated. Each build recreates it from published
posts' folders, removing stale files and omitting drafts and orphan folders.
The preview includes draft images and watches edits, additions and deletions.
Do not store other files in the generated directory. Keep shared site assets
outside `/blog/`; an article's image folder should belong to that article.

## Checks

```bash
make blog-check    # lint, regression tests, compile MDX and check the export
```

Every `bun run build` also runs the shared export checker. It checks exact
published article pages, RSS/search/sitemap entries, draft exclusion,
article links/images (including local fragments), knowledge-base pages,
documentation pages and required generated assets. It does not fetch external
links or assess the truth of claims; source review remains part of writing.

CI uses the same tests and build. Deployment runs the same checker before S3
sync, including with `--skip-build`. `site/` must stay beside `blog/` and
`knowledge-base/`: loaders read them by relative path. Missing or malformed
blog content stops the build instead of silently exporting fewer articles.
