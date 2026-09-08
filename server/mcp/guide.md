# PulsHealth: a guide for AI assistants

This server gives read-only access to one person's Apple Health data. The
PulsHealth iOS app reads HealthKit on their iPhone and syncs every sample to
a database they run themselves; this server answers from that database
through a read-only API. Nothing here can change any data.

## Start here

1. Call `list_available_types` first. It tells you which HealthKit types
   have data, in which unit, how far back the history goes, how current it is
   (`latest`), and — importantly — `today` and `time_zone`, because you do not
   otherwise know what day it is for this person.
2. Pick the tool by the question (recipes below). Prefer the daily tools for
   "how much / how many / on average" questions and `get_latest_metrics` for
   "what is my current ..." questions.
3. Quote units. Say which days have no data rather than treating them as
   zero. Do not sum raw samples yourself: the daily tools already give the
   deduplicated value.

## Tools

| Tool | Answers |
|---|---|
| `list_available_types` | What data exists, its units, its time bounds, today's date and the time zone. |
| `get_profile` | Name, email, date of birth, age, biological sex. |
| `get_latest_metrics(types)` | The newest single reading per quantity type (weight, resting heart rate, HRV, VO2 max, blood oxygen, ...). |
| `get_daily_metrics(types, start_date, end_date)` | One value per calendar day: sums for cumulative types, averages for discrete ones. Up to 10 types and 366 days per call. |
| `get_activity_rings(start_date, end_date)` | Apple Watch Move / Exercise / Stand values and goals per day. |
| `list_workouts(start_date?, end_date?, activity_type?, limit?, offset?)` | Workout summaries, newest first. |
| `get_workout(uuid)` | One workout's per-type statistics, events and multi-sport parts. |

Every tool returns one compact JSON object. Errors come back as tool errors
with the reason (a date in the wrong format, an unknown workout, the product
API rejecting the token, the API being unreachable). Values are rounded to
four decimals.

## The data model in brief

- **Types are HealthKit identifiers.** Quantity types look like
  `HKQuantityTypeIdentifierStepCount`; category types like
  `HKCategoryTypeIdentifierSleepAnalysis`; workouts are
  `HKWorkoutTypeIdentifier`; rings are `HKActivitySummaryTypeIdentifier`.
  Always pass the full identifier.
- **Raw samples** are the individual HealthKit records: a heart-rate reading
  every few seconds during a workout, one weight entry per weigh-in, one
  step-count interval per minute. `get_latest_metrics` returns the newest raw
  sample of a type.
- **Daily metrics** are one number per local calendar day per type. They come
  from the daily aggregates HealthKit computes on the phone when the app
  synced them (`aggregate_rows > 0` in the catalog), otherwise from a
  single-source rollup on the server. This is the surface for totals,
  averages and trends.
- **Activity rings** are the Apple Watch's own daily summaries (Move in kcal,
  Exercise in minutes, Stand in hours, each with a goal). They are what the
  person sees in the Fitness app; do not reconstruct them from samples.
- **Workouts** have a summary (activity, start, end, duration, distance,
  energy) and a detail (per-type min/avg/max/sum statistics, events such as
  pauses and laps, and sub-activities for multi-sport sessions).

## Units

Every value of a type is in that type's canonical unit, given by
`list_available_types` and repeated as `unit` in every answer. The common
ones:

| Types | Unit |
|---|---|
| StepCount, FlightsClimbed, SwimmingStrokeCount | `count` |
| HeartRate, RestingHeartRate, WalkingHeartRateAverage, RespiratoryRate, CyclingCadence | `count/min` (beats or breaths per minute) |
| DistanceWalkingRunning, DistanceCycling, DistanceSwimming, Height | `m` |
| WalkingSpeed, RunningSpeed | `m/s` |
| ActiveEnergyBurned, BasalEnergyBurned, DietaryEnergyConsumed | `kcal` |
| AppleExerciseTime, AppleStandTime, AppleMoveTime, TimeInDaylight | `min` |
| BodyMass, LeanBodyMass | `kg` |
| HeartRateVariabilitySDNN, RunningGroundContactTime | `ms` |
| OxygenSaturation, BodyFatPercentage, WalkingAsymmetryPercentage | `%` — **a fraction**: 0.97 means 97 % |
| VO2Max | `ml/kg*min` |
| BodyTemperature, AppleSleepingWristTemperature | `degC` |
| BloodPressureSystolic / Diastolic | `mmHg` |
| BloodGlucose | `mg/dL` |
| RunningPower, CyclingPower | `W` |
| Dietary macronutrients | `g` (sodium and caffeine `mg`, water `mL`) |

Workout fields carry their unit in the name: `duration_s` (seconds of active
time, pauses excluded), `distance_m` (metres), `energy_kcal`. Convert for the
reader when helpful (1 km = 1000 m; 1 mi = 1609.344 m; pace = duration /
distance).

## Cumulative versus discrete metrics

- **Cumulative** types accumulate over time: steps, distance, active and
  basal energy, exercise and stand minutes, flights climbed, dietary intake.
  Their daily value is a **sum**. Their latest raw sample is one small
  increment (a minute of walking), never a total — for "how many steps
  today" use `get_daily_metrics`, not `get_latest_metrics`.
- **Discrete** types are measurements: heart rate, resting heart rate, HRV,
  weight, blood oxygen, VO2 max, respiratory rate, temperature. Their daily
  value is an **average** of that day's readings; their latest raw sample is
  the current reading.
- Only types the phone aggregates daily appear in `get_daily_metrics`. A
  type with raw rows but no aggregate rows has latest readings only.

## The double-counting rule

An iPhone and an Apple Watch both record steps, distance and energy for the
same minutes. Adding raw samples across both devices roughly doubles daily
step counts — the most common way to misread this data. The daily tools
avoid it: HealthKit's own daily aggregate already merges the devices, and the
server's fallback takes a single source per day. Trust `get_daily_metrics`
and `get_activity_rings`; never total raw readings yourself.

## The time-zone rule

Every date in this server is a calendar day in the server's configured time
zone (`time_zone` in `list_available_types` and `get_profile`), which is set
to match the phone's zone. Inclusive `start_date`/`end_date` ranges return
exactly those days. Instants (`timestamp`, `start`, `end`, `latest`) are ISO
8601 with the zone's UTC offset. If the person travelled, days are still cut
in the configured zone.

## What is not available yet

- **Sleep.** Sleep stages are category samples, which the product API does
  not serve yet. Say so plainly; offer what does exist — resting heart rate,
  HRV and wrist temperature are recorded during sleep, and
  `list_available_types` shows whether `HKCategoryTypeIdentifierSleepAnalysis`
  has data at all. (Planned as SRV-13 in the project's roadmap.)
- Raw sample windows, per-second workout streams and GPS routes, State of
  Mind, medication doses, ECGs. `get_workout` gives per-workout statistics
  but not the curves.

## Recipes: question → tool

| Question | Do this |
|---|---|
| "What data do you have about me?" | `list_available_types`; summarise kinds, units, date range, freshness. |
| "How many steps did I take last week?" | `get_daily_metrics(types=[HKQuantityTypeIdentifierStepCount], start_date, end_date)`; sum the days, name any missing day. |
| "What's my resting heart rate trend?" | `get_daily_metrics` with RestingHeartRate (and HeartRateVariabilitySDNN) over 30–90 days; compare first and last weeks. |
| "What do I weigh now?" / "Has my weight changed?" | `get_latest_metrics([HKQuantityTypeIdentifierBodyMass])` for now; `get_daily_metrics` over months for the trend. |
| "Did I close my rings yesterday?" | `get_activity_rings(yesterday, yesterday)`; a ring is closed when value ≥ goal. |
| "How active was I this month?" | `get_activity_rings` for the month + `get_daily_metrics` for StepCount and AppleExerciseTime. |
| "Compare my runs this month to last month" | `list_workouts(activity_type="running")` twice (one range per month); totals, averages, pace; `get_workout` on a few for heart rate. |
| "What was my longest ride?" | `list_workouts(activity_type="cycling", limit=200)`, page with `offset` if `next_offset` appears; pick the max `distance_m`. |
| "How hard was Tuesday's workout?" | `list_workouts` for that day, then `get_workout(uuid)`; report heart-rate avg/max, energy, duration. |
| "How did I sleep last week?" | Not available yet — see above; offer resting HR / HRV instead. |
| "How old am I?" / "Who is this data for?" | `get_profile`. |

When a range is longer than 366 days, split it into several calls. When the
person asks about "this week" or "last month", compute the dates from
`today` and the zone's calendar (weeks start on Monday unless they say
otherwise).
