# Blog library and follow-up ideas

The starter collection covers getting Apple Health data out, understanding its
measurements, and using it in spreadsheets, Python, dashboards, and AI tools.
The new guides use an editorial date sequence from June 8 to October 8, 2026;
October revisions identify when instructions, sources, and analysis were checked.
Existing posts retain their original dates and permanent URLs.

| Reader question | Article |
|---|---|
| How do I get a usable spreadsheet? | [Export to CSV and Excel](articles/export-apple-health-to-csv-excel.mdx) |
| How can I see my data on a larger screen? | [View on Mac or PC](articles/view-apple-health-on-mac-pc.mdx) |
| Why do the totals disagree? | [Step counts that do not match](articles/apple-health-step-counts-dont-match.mdx) |
| How can an assistant answer from my records? | [ChatGPT and Claude](articles/apple-health-chatgpt-claude.mdx) |
| What does the sleep chart actually measure? | [Sleep stages](articles/apple-watch-sleep-stages.mdx) |
| Why is my cardio fitness estimate low? | [Cardio fitness](articles/apple-watch-cardio-fitness-low.mdx) |
| How do I keep my history when changing phones? | [Backups and transfers](articles/back-up-apple-health-data.mdx) |
| How do I make useful charts myself? | [Python analysis](articles/analyze-apple-health-with-python.mdx) |
| How do I build a dashboard I control? | [Grafana dashboard](articles/apple-health-grafana-dashboard.mdx) |
| Where did the data stop moving? | [Sync troubleshooting](articles/apple-health-not-syncing.mdx) |
| What do individual HRV readings mean? | [Revised HRV guide](articles/apple-watch-hrv-complete-guide.mdx) |
| What is open and what can I run? | [Revised open-source introduction](articles/pulshealth-is-open-source.mdx) |
| How can AI help me set up the database and build on it? | [AI-assisted setup and projects](articles/set-up-pulshealth-with-ai.mdx) |

## Follow-up research

- Compare a daily average with the underlying sampling schedule: how much
  changes when a device records more often during workouts?
- Explain a sleep episode spanning midnight, a time-zone change, and a missing
  night with a reproducible example.
- Build a personal weekly report that reports coverage alongside every trend.

Before writing a follow-up, check whether it belongs as an improvement to one
of the existing guides. Keep device behavior tied to official documentation,
health claims tied to primary research, and personal examples explicitly scoped
to one dataset. Private extracts never belong in this public repository.

## October 25 additions

| Reader question | Article | Original evidence |
|---|---|---|
| Why does my Watch count stairs I did not climb? | [Flights climbed](articles/apple-watch-flights-climbed-wrong.mdx) | Sensor schematic and contrasting record patterns |
| Which calorie totals can I add together? | [Active vs. total calories](articles/apple-watch-active-vs-total-calories.mdx) | One recorded day, original figures, interactive accounting example |
| What did my marathon build actually look like? | [Marathon training history](articles/apple-watch-marathon-training-data.mdx) | Sixteen weeks of selected author aggregates; race kept separate |
| Can I check an AI weekly summary? | [Weekly AI audit](articles/apple-health-ai-weekly-review.mdx) | One preserved response, independent arithmetic, source-freshness check |
| What does headphone exposure mean? | [Headphone audio levels](articles/iphone-headphone-audio-levels.mdx) | WHO reference-duration comparisons and Apple device distinctions |

Each article links primary sources near its claims. Personal examples publish
selected aggregates only; raw extracts and account identifiers remain outside
the repository. Diagrams and illustrative inputs are labeled separately from
measured records.
