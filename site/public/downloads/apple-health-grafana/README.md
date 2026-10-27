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

Validation on October 25, 2026: JSON parsed and all four queries executed as
role grafana inside READ ONLY transactions on a disposable PostgreSQL 17
instance, with a five-second statement timeout and explicit Grafana macro
substitutions. Results: 14 daily points, one receipt-age row, six workout
rows, and 14 provenance rows. Other-user and out-of-range sentinels stayed
excluded. A Los Angeles calendar check placed 00:30 UTC on the prior date
and local midnight at 07:00 UTC. SQL templates match the JSON queries.
Fixture source: blog/analysis/grafana-fixture.sql in the repository.

The layout-reference screenshot in the article shows an earlier Grafana 13.2.3 rendering
against synthetic PostgreSQL 17 records, before the October 24 account-calendar
query update. Query Inspector then verified expanded macros and 14 returned
step rows. No fresh Grafana render or production TimescaleDB performance run
was made for the October 25 editorial revision. Compare a known day and inspect
the expanded queries after importing into your own stack.

queries.sql contains Grafana templates, not standalone psql statements.
Setup: https://pulshealth.com/docs/setup/
Schema: https://pulshealth.com/docs/database/
Article: https://pulshealth.com/blog/apple-health-grafana-dashboard/
