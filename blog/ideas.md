# Blog library and follow-up ideas

The library covers getting Apple Health data out, understanding its measurements,
and using it in spreadsheets, Python, dashboards, and AI tools.

## October 25 editorial review

All 18 articles are included in the October 25 site release. At the maintainer's
request, displayed publication dates follow a two-week editorial sequence from
March 1 through October 25; this is not a future release schedule or a record of
first deployment. Research, extraction, and experiment dates remain explicit in
the articles. The October 25 revision date records this library-wide review.
Permanent URLs are retained.

| Editorial date | Article |
|---|---|
| 2026-03-01 | [Apple Watch HRV: What SDNN Means and How to Read Your Data](articles/apple-watch-hrv-complete-guide.mdx) |
| 2026-03-15 | [How to Export Apple Health Data to CSV and Excel](articles/export-apple-health-to-csv-excel.mdx) |
| 2026-03-29 | [How to View Apple Health Data on Your Mac or PC](articles/view-apple-health-on-mac-pc.mdx) |
| 2026-04-12 | [Why Your Apple Health Step Counts Don't Match](articles/apple-health-step-counts-dont-match.mdx) |
| 2026-04-26 | [Using Apple Health with ChatGPT or Claude: A Practical Guide](articles/apple-health-chatgpt-claude.mdx) |
| 2026-05-10 | [Apple Watch Sleep Stages: What the Chart Can Tell You](articles/apple-watch-sleep-stages.mdx) |
| 2026-05-24 | [Why Apple Watch Says Your Cardio Fitness Is Low](articles/apple-watch-cardio-fitness-low.mdx) |
| 2026-06-07 | [How to Back Up Apple Health Data Before Switching iPhones](articles/back-up-apple-health-data.mdx) |
| 2026-06-21 | [Analyze Apple Health Data with Python: Your First Three Charts](articles/analyze-apple-health-with-python.mdx) |
| 2026-07-05 | [PulsHealth Is Open Source: Explore, Export, and Use Your Apple Health Data](articles/pulshealth-is-open-source.mdx) |
| 2026-07-19 | [Build an Apple Health Dashboard with Grafana](articles/apple-health-grafana-dashboard.mdx) |
| 2026-08-02 | [Why Apple Health Isn't Syncing to Your Other Apps](articles/apple-health-not-syncing.mdx) |
| 2026-08-16 | [Use AI to Set Up a Self-Hosted PulsHealth Database](articles/set-up-pulshealth-with-ai.mdx) |
| 2026-08-30 | [Why Your Apple Watch Says You Climbed Stairs When You Didn't](articles/apple-watch-flights-climbed-wrong.mdx) |
| 2026-09-13 | [Apple Watch Active vs. Total Calories: Follow One Day's Numbers](articles/apple-watch-active-vs-total-calories.mdx) |
| 2026-09-27 | [What My Apple Watch Recorded During Marathon Training](articles/apple-watch-marathon-training-data.mdx) |
| 2026-10-11 | [I Asked AI to Summarize My Apple Health Week. Then I Checked Its Work.](articles/apple-health-ai-weekly-review.mdx) |
| 2026-10-25 | [What Your iPhone's Headphone Audio Levels Actually Tell You](articles/iphone-headphone-audio-levels.mdx) |

The review retained every article because each answers a distinct reader
question. It corrected export date-picker semantics, tightened the AI setup
scope, clarified completed-day reporting, hardened the Python example, updated
Grafana validation, and separated measurement definitions from interpretations.
Primary sources support factual claims near the relevant text. Personal examples
publish selected aggregates; raw extracts and account identifiers stay outside
the repository. Schematics and illustrative inputs are labeled.

## Follow-up research

- Compare a daily average with the underlying sampling schedule and coverage.
- Work through a sleep episode crossing a time-zone change with a reproducible example.
- Compare recurring reports over several weeks, checking per-record freshness.

Before adding a follow-up, check whether it belongs in an existing guide. Keep
content useful on its own rather than repeating setup steps from the canonical
documentation.
