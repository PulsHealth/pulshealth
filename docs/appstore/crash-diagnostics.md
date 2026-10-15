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

## Apple references

- [Acquiring crash reports and diagnostic logs](https://developer.apple.com/documentation/xcode/acquiring-crash-reports-and-diagnostic-logs)
- [Adding identifiable symbol names to a crash report](https://developer.apple.com/documentation/xcode/adding-identifiable-symbol-names-to-a-crash-report)
