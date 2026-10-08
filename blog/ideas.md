# Blog ideas

A lightweight backlog, not a publication schedule. Keep each idea to a reader
question, an observation to develop, and links to supporting material. These
are proposed topics; choose one when ready to write.

| Idea | Reader question | Observation to develop | Starting material |
|---|---|---|---|
| From Apple Health to your first SQL query | How do I do something useful with my own data? | A worked example makes the path from phone to an answer concrete. | [Database guide](../docs/database-guide.md), [exploration notebook](../notebooks/healthkit_database_exploration.ipynb), [server setup](../server/README.md) |
| What happens when your phone is locked? | Why does background sync sometimes wait? | Describe the constraints and the decisions behind reliable catch-up, using actual behavior. | [Sync package](../PulsHealthSync/README.md), [app](../PulsHealth/README.md) |
| Asking AI questions about your health data | What can an assistant actually answer from my data? | Show an end-to-end example, its evidence and its limitations. | [AI guide](../docs/ai.md), [MCP server](../server/mcp/README.md) |
| Why health-data averages can mislead | Which samples belong in this average? | Explain device sources, raw samples, aggregates and calendar boundaries with a reproducible example. | [Database guide](../docs/database-guide.md), [protocol](../docs/protocol/README.md) |

Before expanding the metrics series, review the existing HRV post's numerical
ranges and health claims against primary sources and add citations. Capture
any corrections explicitly rather than attaching sources that only loosely
support the prose.
