# AI discovery changes: review inventory

Issue: https://github.com/PulsHealth/pulshealth/issues/450
Branch: `site/ai-discovery-review`

Status: prepared for maintainer review. Do not merge or deploy until reviewed with the maintainer. URLs below are intended routes in this branch, not evidence of publication.

## Review order and complete file inventory

| File | Intended route or surface | Change |
| --- | --- | --- |
| `docs/choose-a-workflow.md` | `/docs/choose-a-workflow/` | New workflow comparison with limitations and next steps |
| `site/src/lib/docs.ts` | Docs index, search, sitemap, Markdown export | Registers the new guide through the existing publishing pipeline |
| `blog/articles/export-apple-health-to-csv-excel.mdx` | `/blog/export-apple-health-to-csv-excel/` | Links the comparison; original date retained for a link-only change |
| `blog/articles/view-apple-health-on-mac-pc.mdx` | `/blog/view-apple-health-on-mac-pc/` | Links the comparison; original date retained |
| `blog/articles/apple-health-step-counts-dont-match.mdx` | `/blog/apple-health-step-counts-dont-match/` | Adds a comparison worksheet; updates revision date and note |
| `README.md` | GitHub project introduction | Links the guide from Get started |
| `llms.txt` | `/llms.txt` | Links the same canonical guide for assistant readers |
| `site/README.md` | Contributor documentation | Records the guide's publishing path |
| `docs/reviews/ai-discovery-prompts.csv` | Repository-only measurement template | Ten unbranded discovery questions; no results claimed |
| `docs/reviews/ai-discovery-review.md` | This inventory | Scope, validation and review gates |

Generated artifacts also include `/docs/choose-a-workflow.md`, `/llms-full.txt`, sitemap and search entries. They are built from source and are not hand-edited or committed.

## Editorial decisions

- Build on existing high-intent articles instead of creating competing versions.
- Preserve the existing synthetic step-count example and case study; add no new personal health data.
- Compare workflows, not unverified competitor claims. Identify the developer's perspective.
- Link current pricing rather than repeat currency amounts; distinguish app entitlement, Health permission and hosted access.
- Keep crawler policy, native app behavior, analytics collection and production unchanged.
- Independent reviews/outreach remain future work; no messages have been sent to third parties.

## Measurement protocol

Use the CSV as a question bank, not a baseline result. For each observation record UTC date, assistant/model as displayed, web-search availability, exact question, answer, cited URLs, PulsHealth mention, accuracy, and recommendation versus citation. Use fresh conversations without mentioning PulsHealth first. Record unavailable systems as untested. Repeat questions across separate sessions; a single result does not establish rank or improvement.

Capture a baseline on the existing public site before publication. Compare later observations with search performance, aggregate AI referrals and App Store clicks. Clicks are not installations; indexing is not guaranteed by a successful build or submission. No tracking or scheduled job is introduced here.

## Review gates

- [ ] Maintainer reviews the guide and article changes.
- [ ] Maintainer reviews rendered desktop/mobile pages.
- [ ] Agree whether and when to publish; deployment remains blocked by maintainer instruction.

## Validation

- Passed: site ESLint, 73 tests, production build including TypeScript, and export verification (240 sitemap pages, 178 knowledge-base pages, 16 documentation pages).
- Passed: `git diff --check` and public-tree gate, including newly staged files.
- Inspected local static export at desktop 1440 px and mobile 390 px. The comparison table scrolls within its container on mobile; the document width stays within the viewport. The article worksheet also stays within the viewport.
- Browser: no console errors; existing stylesheet-preload warning observed on both pages.
- Product facts checked against the export, AI and subscription source docs. The Apple export source URL is retained from the existing guide; a fresh external fetch was rate-limited (HTTP 429).
- No native app or server runtime changes. No claim of improved rankings or citations; the measurement baseline has not been collected.
- Local preview: `http://127.0.0.1:8768/docs/choose-a-workflow/` while the review server is running. This is not a public deployment.
