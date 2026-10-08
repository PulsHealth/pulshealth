# PulsHealth starter dashboard

Import dashboard.json in Grafana on the current PulsHealth reference stack.
It uses the provisioned PostgreSQL datasource UID `puls-tsdb` and SELECT-only
`grafana` database role. It contains no connection details or credentials.
Set the User UUID textbox to your own existing PulsHealth user UUID.
Set the dashboard display time zone to the stack's PULS_TIME_ZONE.

The default UUID is a placeholder. No data is expected before replacing it.
The UUID is SQL-escaped with `${user:sqlstring}` and cast to uuid. It is a
filter, NOT an access-control boundary. Only trusted operators should access
this datasource: its database role can read multiple people's health data.
Do not expose it as a public or untrusted multi-user dashboard.

Daily steps include whole local days intersecting the time range. They use
metric_daily, retaining aggregate/rollup provenance, and can include a partial
current day. Workout points filter by start instant. The receipt-age stat
ignores the time picker and uses a rolling 90-day lookback; it measures upload
receipt, not measurement recency or complete sync coverage. No value means
no receipt was found within that lookback.

Validation: JSON parsed; all four SQL queries executed as read-only queries
against synthetic PostgreSQL 15 fixture tables with the documented columns
and explicit substitutions for Grafana macros. Other-user and out-of-range
fixtures were excluded. The four queries also executed successfully against
a private owner-scoped production database in a READ ONLY transaction with a
25-second statement timeout. A seven-day window returned 7 daily step rows,
10 workout rows, 7 provenance rows, and 1 receipt-age row. No private query
outputs are included. This does not test Grafana rendering, macro expansion
inside Grafana, or production TimescaleDB performance. Review the Query
Inspector and compare a known day after import.

queries.sql contains Grafana templates, not standalone psql statements.
Setup: https://pulshealth.com/docs/server/
Schema: https://pulshealth.com/docs/database/
Article: https://pulshealth.com/blog/apple-health-grafana-dashboard/
