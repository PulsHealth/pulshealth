# PulsHealth starter dashboard

Import dashboard.json in Grafana on the current PulsHealth reference stack.
It uses the provisioned PostgreSQL datasource UID `puls-tsdb` and SELECT-only
`grafana` database role. It contains no connection details or credentials.
Set the User UUID textbox to your own existing PulsHealth user UUID.
Set the dashboard display time zone to the account reporting zone (users.time_zone,
falling back to PULS_TIME_ZONE). SQL uses puls_user_time_zone(user UUID).
Phone aggregates retain their recorded day when temporal context is available;
that may differ from raw reporting days during travel.

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

Historical validation before the October 24, 2026 account-calendar update: JSON parsed; all four SQL queries executed as read-only queries
against synthetic PostgreSQL 15 fixture tables with the documented columns
and explicit substitutions for Grafana macros. Other-user and out-of-range
fixtures were excluded. The four queries also executed successfully against
a private owner-scoped production database in a READ ONLY transaction with a
25-second statement timeout. A seven-day window returned 7 daily step rows,
10 workout rows, 7 provenance rows, and 1 receipt-age row. No private query
outputs are included. The exact dashboard was additionally rendered in Grafana 13.2.3 with
PostgreSQL 17 synthetic fixtures: 14 daily rows, 6 workouts, and a receipt-age
result. Query Inspector confirmed expanded date/UUID filters and 14 step rows.
Fixture source: blog/analysis/grafana-fixture.sql in the repository. This does
not test production TimescaleDB performance. Review the Query Inspector and
compare a known day after import.

queries.sql contains Grafana templates, not standalone psql statements.
Setup: https://pulshealth.com/docs/setup/
Schema: https://pulshealth.com/docs/database/
Article: https://pulshealth.com/blog/apple-health-grafana-dashboard/

October 24, 2026 validation: the updated four queries ran as the read-only
Grafana role against the disposable PostgreSQL 17 fixture: 14 daily points,
1 receipt-age row, 6 workouts, and 14 provenance rows. Other-user and
out-of-range sentinels were excluded. A Los Angeles account-calendar check
placed 00:30 UTC on the prior date and local midnight at 07:00 UTC. Download
SQL matches the JSON queries. Production TimescaleDB and a fresh Grafana
render were not re-tested for this calendar-only update.
