# Choose an Apple Health export or sync workflow

For a spreadsheet or a one-time analysis, start with a file export. For a dashboard you revisit, sync selected data to a database. For an AI summary, share a small export or connect a compatible assistant to an already-synced database. These paths have different setup and privacy requirements.

This guide is maintained by PulsHealth's developer. It compares workflows, including Apple's built-in export; it is not an independent ranking of apps.

## Compare the options

| Workflow | Best suited to | What you need | Where the data goes | Main limitation |
| --- | --- | --- | --- | --- |
| Apple's built-in XML export | Keeping an independent export or using an XML analysis tool | Health on iPhone; no PulsHealth app or server | The destination you choose when sharing | XML needs conversion for a conventional spreadsheet |
| PulsHealth file export | Selected CSV, JSON or JSONL files; spreadsheet and local-code analysis | The app and Health read access; no account or server | Generated on-device, then saved or shared where you choose | A saved file is a snapshot; format and history limits apply |
| PulsHealth self-hosted sync | A browser dashboard, SQL, API access or integrations you operate | App, reachable compatible server, Docker and ongoing maintenance | Your chosen server | Backend is pre-release; you manage access, upgrades and backups |
| PulsHealth hosted sync | A browser dashboard without operating the database yourself | An approved hosted account and the app | The developer-operated hosted service | Access is by request/invitation; app Pro does not include hosting |
| File shared with an AI assistant | A bounded question about a selected date range | An export and an assistant that accepts its format | The assistant provider receives what you share | It cannot see later records unless you provide them |
| Database connected to an AI assistant | Repeated questions over synced records | A working database, compatible MCP client and configured access | The assistant provider receives the records it reads | Read-only access does not mean on-device processing or guaranteed conclusions |

Apple documents its XML export under [sharing health data](https://support.apple.com/guide/iphone/iph5ede58c3d/ios). For PulsHealth, the [export reference](export.md), [server setup](setup.md), [AI connection guide](ai.md) and [privacy policy](privacy-policy.md) describe the individual paths.

## Choose by the result you need

### I want a spreadsheet

Use Apple's export if you already have a suitable XML converter. Use PulsHealth when you want to select data and create CSV on the phone. For daily step charts, choose a daily aggregate rather than adding all raw Watch and phone records together. Follow the [CSV and Excel walkthrough](https://pulshealth.com/blog/export-apple-health-to-csv-excel/).

CSV is not a lossless representation of every HealthKit object. Read the export manifest's omissions and warnings, and keep JSONL when its richer representation fits your analysis. An app export is not a promise that every Apple Health record can be read or restored.

### I want Apple Health on a Mac or PC

A file works for occasional analysis. A synced dashboard works for repeated browsing. The phone still supplies the data: refreshing the browser does not query HealthKit on your iPhone. Start with the [desktop viewing guide](https://pulshealth.com/blog/view-apple-health-on-mac-pc/).

### I want to own the database or build an integration

Use the self-hosted stack if you are comfortable maintaining a server. Start with [setup](setup.md), verify an acknowledged first sync, then use the [product API](api.md) or [database guide](database-guide.md). Developers can also implement the [open sync protocol](protocol/README.md) with their own receiver. File exports remain available without operating any backend.

### I want an AI summary

Start with a short date range and only the fields needed to answer the question. For repeated access, follow the [AI connection guide](ai.md) after syncing your phone. Ask the assistant to state its date range, time zone, missing dates, source and calculation. Review the underlying records before trusting a conclusion. Connecting an assistant does not give it direct access to Apple Health, and read-only tools still disclose retrieved data to the chosen AI provider.

## App price, hosting and permissions are separate

The Free app includes Explore, unlimited manual exports covering the most recent 30 days, and automatic sync of up to five types over that history window. Pro expands export history and supported sync selections to the history Health permits. Check the [current Free/Pro comparison](https://pulshealth.com/pricing/) for prices and limits.

The open-source stack is free to run yourself; infrastructure and maintenance are your responsibility. App purchases and hosted service access are separate. Request hosted access through the [account page](https://app.pulshealth.com/signup); submitting a request does not guarantee immediate access.

Neither Pro nor a server can recover data HealthKit does not make available. Background sync is scheduled by iOS and is not a continuous or guaranteed real-time feed. See [sync troubleshooting](https://pulshealth.com/blog/apple-health-not-syncing/) when records are missing or late.

## Before moving more data

1. Try one type and a short, completed date range.
2. Confirm whether you need raw records or a summary; keep their calculations separate.
3. Check the result's coverage, time zone, units and freshness.
4. Save an export deliberately, or verify the first sync and your server's backup procedure.
5. Review who receives the data, including any cloud storage or AI provider you choose.
