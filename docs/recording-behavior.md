# Understand how health data is recorded

A HealthKit type tells you what a value means. It does not promise how often a device will record it, how much history an app can read, or how many database rows represent one event. Use this guide alongside the individual type pages when exploring your own data.

## A record, a measurement and an upload are different things

A sample can describe a point in time or an interval. A quantity sample can also contain a series of quantities. Count stored records separately from the underlying sensor observations and from sync batches. Start-to-start gaps describe the records available to your query, not necessarily the hardware sampling rate. [Apple: samples](https://developer.apple.com/documentation/healthkit/samples), [cumulative quantity samples](https://developer.apple.com/documentation/healthkit/hkcumulativequantitysample).

For an interval, inspect both start and end. Do not interpret a zero-length record as zero time spent measuring, or assume that an interval's value remains valid until the next record. Event timestamps answer when something was recorded as happening; upload timestamps answer when it reached the server.

## Choose measurements that fit the type

| Kind of data | Useful recording measurements | Common misinterpretation |
|---|---|---|
| Discrete quantities, such as weight or HRV | Records per day, observed days, gaps, interval duration, source and context | Treating absent days as zero or a sample mean as a time-weighted mean |
| Cumulative quantities, such as steps | Interval duration, source overlap, records per day, correctly configured totals | Treating row count as the total or summing overlapping sources |
| Categories, such as sleep or symptoms | Category counts, interval coverage, episodes when appropriate, explicit negative records | Treating every row as a separate episode or an absent symptom record as a negative response |
| Characteristics | Available value and provenance; applicable date context | Inventing a sampling cadence for a characteristic rather than a sample history |
| Correlations, such as blood pressure | Parent object and linked component completeness | Counting a correlation and its component samples as independent measurements |

These are analytical recommendations, not new HealthKit type definitions. The [sync catalog](protocol/catalog.md) remains authoritative for PulsHealth's type vocabulary, units and supported aggregate functions.

## Describe frequency as a distribution

Use a stated date range and timezone. For each type, report total records, calendar days observed, days with at least one record, records per calendar day, and records per day with data. Including empty days in one denominator but not another answers different questions; label both.

Then inspect median and percentile ranges for record counts, positive start-to-start gaps and sample durations. Keep zero gaps visible as a separate count. Divide by source and relevant context before combining results. For context-specific gaps, say whether pairs must belong to the same episode; otherwise an overnight or off-device gap may dominate the distribution.

One user's median gap is an observation, not a universal device specification. A change in record density is a reason to inspect context and provenance before interpreting a change in health.

## Separate sources and context

HealthKit tracks the recording source and its version separately from hardware-device information. An app can be the source of data produced by another device. Retain identifiers and versions; a display name alone is not a unique physical-device identity. [Apple: HealthKit objects and source revisions](https://developer.apple.com/documentation/healthkit/about-the-healthkit-framework).

A workout, sleep interval or other context should be assigned using an explicit rule. Timestamp overlap is useful but does not prove causality or a HealthKit object relationship. Estimates may be recorded after a workout ends. If a proximity rule is used, state its tolerance and retain ambiguous or unmatched cases.

For heart-rate motion metadata, **active includes working out**. The enum does not provide a workout identifier. [Apple: heart-rate motion context](https://developer.apple.com/documentation/healthkit/hkmetadatakeyheartratemotioncontext).

## Missing data is not a health result

A day containing one sample is an observed day, not a complete day of monitoring. No records may reflect the recording schedule, device availability, app behavior, incomplete sync, or restricted access. The rows alone usually cannot identify the cause.

HealthKit does not reveal whether read access was denied; queries may look empty. Recent-history access can also limit what is readable. Preserve that uncertainty rather than diagnosing a permission failure or treating an empty result as proof that nothing happened. [Apple: authorizing access](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data).

Keep measured zero, explicit negative category values, empty aggregate buckets and absent records distinct. Carrying a previous reading forward is a display or analysis choice; it must retain the original timestamp and disclose that the value was not newly observed.

## Check what an aggregate actually summarizes

For raw cumulative samples, overlapping sources can make a naive sum misleading. HealthKit statistics queries have their own source-handling options; a SQL sum of raw records is not the same operation. Verify the function, source/device filter and time window. [Apple: statistics queries](https://developer.apple.com/documentation/healthkit/hkstatisticsquery).

A series labeled “1 day” can have a non-midnight anchor. Check **both bucket boundaries** against the intended local calendar. Derive the next local midnight using calendar arithmetic: a day around a daylight-saving transition need not last 24 hours. Do not relabel a shifted bucket as a calendar day without recomputing its contents. [Apple: statistics collection anchors](https://developer.apple.com/documentation/healthkit/hkstatisticscollectionquery/init(quantitytype:quantitysamplepredicate:options:anchordate:intervalcomponents:)).

For sleep, In Bed can overlap asleep stages. Choose the categories relevant to the question and merge overlapping intervals before totaling time. Resolve conflicting stage labels explicitly; adding all rows or merely grouping them by their start date does not reconstruct a night. [Apple: sleep categories](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis).

For discrete measurements, densely recorded periods receive more weight in a sample average. Label the weighting rule. Do not average daily medians to obtain a median over all records.

## Keep knowledge and observations connected, but distinct

Type pages contain sourced explanations and separately dated recording guidance. Personal observation profiles should live with the person's data, linked by HealthKit identifier. A profile should record its window, timezone, source/context selection, numerator and denominator, calculation version and refresh time.

Distinguish documented behavior from observed patterns and untested explanations. Public examples should be synthetic; source names, external identifiers and personal statistics belong in private records. A recording-behavior review does not certify every clinical range or platform-availability statement in an older article.

See the [database guide](database-guide.md) for calendar-aligned daily analytics and decoding legacy motion-context metadata without changing the stored evidence.
