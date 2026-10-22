# Diagnosing App Store crashes

App Store Connect analytics shows crash counts. For causes, open **Xcode →
Window → Organizer → Crashes**, select PulsHealth, and check the version,
distribution and date filters. Inspect every crash group and its individual
reports: exception or termination reason, crashed thread, app frames, source
line, version/build, device and OS. Counts alone do not establish a cause or
identify an affected person. Apple's reports depend on diagnostic sharing;
the Organizer is not a complete record of every crash.

Keep each uploaded `.xcarchive` and its matching dSYMs, together with the
source commit and build number. An unsymbolicated report needs symbols from
the exact crashed binary; rebuilding the same source does not produce a
replacement matching dSYM. Do not commit raw reports, device identifiers,
archives or personal diagnostic exports to this public repository.

After each release, inspect Organizer for new groups. For a reported problem,
record the version/build, approximate time and triggering screen or action.
If Apple has no report, the affected person can choose to share their device
crash log as described in Apple's guide below. The app's Activity diagnostics
export supplies sync events and wake history; it does not contain a crash
stack and should not be mistaken for one. No automatic third-party crash
upload is configured by this workflow.

For a fix, turn the failing condition into a regression test, preserve the
original exception and source location in the development record, and test
the updated app. Upload a new build number and verify the affected flow in
TestFlight before submitting it. A source fix does not change an already
uploaded build. Only mark a crash group resolved after the fixed build is
available, and check whether it recurs in that build.

## Histogram crash investigated on 2026-10-08

Organizer showed one crash group across three devices. Five downloadable
reports from version 1.6 (19) all identified:

```text
Swift runtime failure: Range requires lowerBound <= upperBound
HistogramChart.body — ExploreCharts.swift:66
```

The reference-band expression constructed
`max(typical.lowerBound, histogram.lowerBound)...min(typical.upperBound, histogram.upperBound)`
before testing overlap. Disjoint ranges therefore trap while rendering the
chart. Checking the endpoints before constructing the range omits a band
that has no overlap. Regression tests cover both disjoint directions,
touching endpoints, missing reference data and valid partial/full overlap.
The reports establish this crash cause, but do not prove that every crash
counted in App Store Connect had the same cause.

## Regression audit on 2026-10-15

Tracking issues: [histogram #253](https://github.com/PulsHealth/pulshealth/issues/253)
and [statistics options #255](https://github.com/PulsHealth/pulshealth/issues/255).
The histogram fix `9ac154f` is already an ancestor of current `main`.
`HistogramChartTests` covers disjoint ranges in both directions, touching
endpoints, a missing reference, a zero-width histogram and clipped/full
intersection. Keep this protection rather than reintroducing the old range
expression. An installed 1.6 (19) binary still contains its original code;
source history does not establish App Store delivery of a fix.

Organizer also retains a historical TestFlight 1.0 (4) crash in
`HKQuantityType.supportsStatisticOptions` → `HKStatistics._validateOptions`
→ `HKStatisticsCollectionQuery.queue_validate`. It predates the current
analytics window and must not be counted as an explanation of those events.
Current aggregate legality derives from `HKQuantityType.aggregationStyle`:
cumulative quantities offer sum/most-recent/duration; discrete quantities
also offer average/min/max but exclude sum. Both the engine's aggregate sync
and the explorer's preview revalidate the requested function before calling
the shared query implementation. The debug matrix iterates only allowed
functions; no other production statistics-query constructors were found in
this audit.

`AggregateMatrixTests` probes every available quantity type × function against
HealthKit behind the test-only Objective-C exception catcher. It also tests
public sync and preview entry points with illegal average/min/max-of-steps
and sum-of-heart-rate configurations, including unchanged sync progress.
Run the hosted matrix and `HistogramChartTests` on the pinned iOS runtimes;
a declaration or successful descriptor construction alone does not prove
that HealthKit accepts a query when executed. Record actual run results in
the associated issue/PR. Simulator checks remain separate from testing the
affected flows on a physical device/TestFlight and monitoring the released
build for recurrence.

## Cached 2.1 crash triage on 2026-10-20

Five locally cached Apple reports for **2.1 (22)**, dated October 13–14, fail in
`HKObjectTypeRaiseInvalidIdentifierException` while constructing a quantity type.
Four reach `HealthTypeDescriptor.sampleType` through Explore's readable-history
query. One reaches `HealthTypeCatalog.allowedAggregateFunctions` through Sync's
empty aggregate selection. These are downloaded reports, not a fresh Organizer
refresh and not a complete count of affected people.

Fix `2accbed` ([#256](https://github.com/PulsHealth/pulshealth/pull/256)), already
contained in the recorded 2.2 (28) candidate, replaces the throwing type
initializers with optional factories, checks runtime availability, and reuses
that safe resolution for aggregate choices. Existing catalog and app-hosted
aggregate regression tests cover unsupported identifiers. Keep their protection;
no additional speculative crash fix was made during this triage.

The report [#210](https://github.com/PulsHealth/pulshealth/issues/210) supplies no
app version/build, crash stack or event time. The cached Sync stack is a plausible
lead, not attribution to that report. Leave it unresolved until a matching report
or affected-build reproduction is available; verify recurrence against the fixed
TestFlight/public build. Preserve raw diagnostics privately.

## Aggregate-options crash found on 2026-10-22

A refreshed Organizer shows two App Store **2.1 (22)** reports from October 14
in one crash group on one device. Both reach `AppModel.config.getter` from
`AggregateOptionsSheet.startSection` while `update` is editing an aggregate.
Turning **Same as Sync** off reads the sync start date from `model.config`
inside a closure already holding an `inout` write to that configuration.
A hosted regression using the original mutation reproduced Swift runtime
messages `Simultaneous accesses` and `Fatal access conflict detected`.
This is a separate cause from the unsupported-HealthKit-identifier reports.

The fixed `AppModel.editSyncAggregate` edits a local aggregate-list value before
writing it back, so an edit closure may safely read the configuration.
`AggregateOptionsTests` exercises that production path, including both
Same as Sync transitions, another option, sibling preservation and a removed
aggregate. It also checks that edits stay staged until Apply without changing
the applied configuration or persisted engine configuration.

A source fix and simulator checks do not update 2.1 or the already-uploaded
2.2 (28) candidate. Include the fix in a new numbered build, verify the toggle
on a physical device/TestFlight, and monitor the released build for recurrence.
Do not attribute issue #210 to this group without matching reporter evidence.

## Apple references

- [Acquiring crash reports and diagnostic logs](https://developer.apple.com/documentation/xcode/acquiring-crash-reports-and-diagnostic-logs)
- [Adding identifiable symbol names to a crash report](https://developer.apple.com/documentation/xcode/adding-identifiable-symbol-names-to-a-crash-report)
