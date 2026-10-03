# Puls Sync Protocol v1 fixture corpus

Known-good batches, one scenario per file, as plain-text NDJSON so they can
be read and diffed. Each `NN-name.ndjson` has a sibling `NN-name.expected.json`
with the HTTP status and the count body a conformant reference server returns,
and optionally a `state`: rows the receiver must hold once the corpus has been
applied up to and including that fixture, for what the counts cannot show.
The only table `state` defines today is `activitySummaries` — each entry a
`localDate` and every ring field, `null` included — which is how fixture 08
tests that a re-sent day replaces the stored row.

| Fixture | Exercises |
|---|---|
| `01-quantity-category` | Quantity samples (explicit nulls, metadata, temporal contexts) and a category sample in one batch; upper-case UUIDs and fractional timestamps, as the app sends them |
| `02-workout-route-series` | A workout with per-type statistics, events and a sub-activity; a route chunk; a series chunk; upper-case UUIDs, fractional timestamps |
| `03-aggregates-activity-profile` | Two aggregate buckets (one explicit-null), two activity summaries (one legacy without `localDate`), a profile line that clears name and email |
| `04-legacy-header` | A pre-versioning header (no `schemaVersion`, no optional counts) re-sending, in lower case, a UUID 01 sent upper-case: the duplicate is a no-op |
| `05-deletions` | A tombstone for a stored sample (named in mixed case) and one for an unknown UUID |
| `06-empty-probe` | The header-only connection probe (`type` `probe`) |
| `07-special-kinds` | Heartbeat series, ECG, State of Mind, medication dose |
| `08-activity-summary-replace` | A day 03 stored, re-sent with three rings omitted: the omitted values must be cleared (`state`) |

The expected counts assume the fixtures are applied **in file-name order to
an empty store**: `04` re-sends a UUID that `01` stored, `05` deletes it, and
`08` replaces a day `03` stored.
Where the order matters, the `notes` field of the `expected.json` gives the
standalone counts. Replaying any
fixture immediately after itself must return 2xx with `accepted` 0.

The lines started from the Go parser's own test fixtures
(`server/ingest/parse_test.go`) and its README example, reshaped where the app
differs: the app's UUIDs are upper-case and its timestamps fractional, and a
corpus without them let a receiver pass while comparing UUIDs case-sensitively.
`tools/protocol-check` validates every fixture against the schemas in CI,
checks that the corpus keeps that app shape (`TestCorpusIsAppShaped`) and
that every `state` follows from the lines under the replace rule, and
`examples/receivers/python-sqlite/smoke_test.py` posts them to a live
receiver and compares the counts:

```bash
# validate the corpus (and any batch you capture) against the schemas
cd tools/protocol-check && go test ./... && go run . ../../docs/protocol/fixtures/*.ndjson

# post the corpus to a receiver
python3 examples/receivers/python-sqlite/smoke_test.py --url http://localhost:8080 --token "$PULS_TOKEN"
```

To send one fixture by hand:

```bash
gzip -c docs/protocol/fixtures/01-quantity-category.ndjson | curl -sS -X POST http://localhost:8080/v1/batches \
  -H "Authorization: Bearer $PULS_TOKEN" -H "Content-Type: application/x-ndjson" \
  -H "Content-Encoding: gzip" -H "X-Puls-Protocol: 1" \
  -H "X-User-ID: 5ea4d000-0000-4000-8000-000000000001" --data-binary @-
```

Adding a scenario: write the batch, run `protocol-check` on it, add the
`expected.json`, and extend the coverage test in `tools/protocol-check` if it
introduces a new line type or kind. A new `state` table needs both
`TestStateExpectationsFollowReplaceSemantics` and `smoke_test.py` taught it
first; each refuses a table it does not know.
