import Foundation
import HealthKit

/// One syncable HealthKit type: identifier, human name, canonical unit, and grouping.
public struct HealthTypeDescriptor: Identifiable, Sendable, Hashable {
    public enum Group: String, Sendable, CaseIterable {
        case activity = "Activity"
        case heart = "Heart"
        case body = "Body"
        case respiratory = "Respiratory"
        case sleep = "Sleep"
        case nutrition = "Nutrition"
        case vitals = "Vitals"
        case workouts = "Workouts"
        case other = "Other"
    }

    public var id: String { identifier }
    /// Raw HealthKit identifier, e.g. "HKQuantityTypeIdentifierHeartRate".
    public let identifier: String
    public let displayName: String
    public let kind: SampleKind
    /// Canonical unit string all values are converted to before upload (nil for category/workout).
    public let unitString: String?
    public let group: Group
    /// Rough expected sample density, used for backfill ETA estimates (samples per active day).
    public let estimatedSamplesPerDay: Int

    var sampleType: HKSampleType? {
        switch kind {
        case .quantity: return HKQuantityType(HKQuantityTypeIdentifier(rawValue: identifier))
        case .category: return HKCategoryType(HKCategoryTypeIdentifier(rawValue: identifier))
        case .workout: return HKWorkoutType.workoutType()
        case .heartbeatSeries: return HKSeriesType.heartbeat()
        case .ecg: return HKObjectType.electrocardiogramType()
        case .stateOfMind:
            guard #available(iOS 18.0, *) else { return nil }
            return HKObjectType.stateOfMindType()
        case .medicationDose:
            guard #available(iOS 26.0, *) else { return nil }
            return HKObjectType.medicationDoseEventType()
        case .activitySummary:
            // HKActivitySummaryType is an HKObjectType, not an HKSampleType. It
            // can't ride the bulk-read sample-type path (or the observer); the
            // engine unions HKObjectType.activitySummaryType() into the read set
            // separately. Returning nil here keeps it out of both.
            return nil
        }
    }

    /// True for types HealthKit only exposes via `requestPerObjectReadAuthorization`
    /// (excluded from bulk authorization, observer, and background-delivery APIs).
    var needsPerObjectAuthorization: Bool { kind == .medicationDose }

    var unit: HKUnit? { unitString.map(HKUnit.init(from:)) }
}

/// Registry of every type PulsHealthSync knows how to export.
public enum HealthTypeCatalog {
    /// Special identifier used for workouts (HKWorkoutType has no string identifier).
    public static let workoutIdentifier = "HKWorkoutTypeIdentifier"
    /// Special identifier for daily activity summaries (the activity rings).
    /// HKActivitySummaryType has no string identifier; the server keys its
    /// `activity_summaries` table on date, not this string, and uses it only
    /// for `/v1/stats` bookkeeping.
    public static let activitySummaryIdentifier = "HKActivitySummaryTypeIdentifier"
    /// Series/special type identifiers (these match the HK type identifier constants;
    /// the server hardcodes the same strings in its stats query).
    public static let heartbeatSeriesIdentifier = "HKDataTypeIdentifierHeartbeatSeries"
    public static let electrocardiogramIdentifier = "HKDataTypeIdentifierElectrocardiogram"
    public static let stateOfMindIdentifier = "HKDataTypeIdentifierStateOfMind"
    public static let medicationDoseIdentifier = "HKMedicationDoseEventTypeIdentifierMedicationDoseEvent"

    public static let all: [HealthTypeDescriptor] = quantityTypes + categoryTypes + specialTypes + [
        HealthTypeDescriptor(
            identifier: workoutIdentifier, displayName: "Workouts", kind: .workout,
            unitString: nil, group: .workouts, estimatedSamplesPerDay: 2
        ),
        HealthTypeDescriptor(
            identifier: activitySummaryIdentifier, displayName: "Activity Rings",
            kind: .activitySummary, unitString: nil, group: .activity, estimatedSamplesPerDay: 1
        ),
    ]

    /// True for the daily activity-summary (rings) type, which is exported via
    /// `HKActivitySummaryQuery` rather than the anchored/observer sample path.
    public static func isActivitySummary(_ identifier: String) -> Bool {
        identifier == activitySummaryIdentifier
    }

    /// Series + non-quantity special types; OS-gated entries only appear where the
    /// runtime can actually resolve their `HKSampleType`.
    public static let specialTypes: [HealthTypeDescriptor] = {
        var out: [HealthTypeDescriptor] = [
            HealthTypeDescriptor(
                identifier: heartbeatSeriesIdentifier, displayName: "Heartbeat Series (beat-to-beat)",
                kind: .heartbeatSeries, unitString: nil, group: .heart, estimatedSamplesPerDay: 6
            ),
            HealthTypeDescriptor(
                identifier: electrocardiogramIdentifier, displayName: "ECG",
                kind: .ecg, unitString: nil, group: .heart, estimatedSamplesPerDay: 1
            ),
        ]
        if #available(iOS 18.0, *) {
            out.append(HealthTypeDescriptor(
                identifier: stateOfMindIdentifier, displayName: "State of Mind",
                kind: .stateOfMind, unitString: nil, group: .other, estimatedSamplesPerDay: 2
            ))
        }
        if #available(iOS 26.0, *) {
            out.append(HealthTypeDescriptor(
                identifier: medicationDoseIdentifier, displayName: "Medication Doses",
                kind: .medicationDose, unitString: nil, group: .other, estimatedSamplesPerDay: 3
            ))
        }
        return out
    }()

    public static func descriptor(for identifier: String) -> HealthTypeDescriptor? {
        byIdentifier[identifier]
    }

    /// Sample types that are safe to pass to HealthKit's normal bulk read APIs.
    /// Per-object-only Health Records types, such as medication dose events, must
    /// use `requestPerObjectReadAuthorization` instead.
    public static var bulkReadAuthorizationSampleTypes: [HKSampleType] {
        bulkReadAuthorizationSampleTypes(for: all.map(\.identifier))
    }

    /// Bulk-auth sample types for a specific set of catalog identifiers: unknown
    /// identifiers and per-object types are skipped, and workout routes ride along
    /// whenever workouts are included (they have their own object type) unless
    /// `includeWorkoutRoutes` is false.
    public static func bulkReadAuthorizationSampleTypes(
        for identifiers: [String], includeWorkoutRoutes: Bool = true
    ) -> [HKSampleType] {
        var types = identifiers
            .compactMap { descriptor(for: $0) }
            .filter { !$0.needsPerObjectAuthorization }
            .compactMap(\.sampleType)
        if includeWorkoutRoutes && identifiers.contains(workoutIdentifier) {
            types.append(HKSeriesType.workoutRoute())
        }
        return types
    }

    public static func usesPerObjectAuthorization(_ identifier: String) -> Bool {
        descriptor(for: identifier)?.needsPerObjectAuthorization ?? false
    }

    @available(iOS 26.0, *)
    public static var perObjectReadAuthorizationObjectTypes: [HKObjectType] {
        [
            HKObjectType.userAnnotatedMedicationType(),
            HKObjectType.medicationDoseEventType(),
        ]
    }

    private static let byIdentifier: [String: HealthTypeDescriptor] =
        Dictionary(uniqueKeysWithValues: all.map { ($0.identifier, $0) })

    // MARK: - Quantity types

    private static func q(
        _ id: HKQuantityTypeIdentifier, _ name: String, _ unit: String,
        _ group: HealthTypeDescriptor.Group, perDay: Int
    ) -> HealthTypeDescriptor {
        HealthTypeDescriptor(
            identifier: id.rawValue, displayName: name, kind: .quantity,
            unitString: unit, group: group, estimatedSamplesPerDay: perDay
        )
    }

    public static let quantityTypes: [HealthTypeDescriptor] = [
        // Activity
        q(.stepCount, "Steps", "count", .activity, perDay: 250),
        q(.distanceWalkingRunning, "Walking + Running Distance", "m", .activity, perDay: 250),
        q(.distanceCycling, "Cycling Distance", "m", .activity, perDay: 20),
        q(.flightsClimbed, "Flights Climbed", "count", .activity, perDay: 30),
        q(.activeEnergyBurned, "Active Energy", "kcal", .activity, perDay: 700),
        q(.basalEnergyBurned, "Resting Energy", "kcal", .activity, perDay: 350),
        q(.appleExerciseTime, "Exercise Minutes", "min", .activity, perDay: 60),
        q(.appleStandTime, "Stand Minutes", "min", .activity, perDay: 60),
        q(.appleMoveTime, "Move Minutes", "min", .activity, perDay: 60),
        q(.walkingSpeed, "Walking Speed", "m/s", .activity, perDay: 60),
        q(.walkingStepLength, "Step Length", "m", .activity, perDay: 60),
        q(.walkingDoubleSupportPercentage, "Double Support %", "%", .activity, perDay: 60),
        q(.walkingAsymmetryPercentage, "Walking Asymmetry %", "%", .activity, perDay: 30),
        q(.runningSpeed, "Running Speed", "m/s", .activity, perDay: 50),
        q(.runningPower, "Running Power", "W", .activity, perDay: 50),
        q(.runningGroundContactTime, "Ground Contact Time", "ms", .activity, perDay: 50),
        q(.runningVerticalOscillation, "Vertical Oscillation", "cm", .activity, perDay: 50),
        q(.runningStrideLength, "Running Stride Length", "m", .activity, perDay: 50),
        q(.cyclingPower, "Cycling Power", "W", .activity, perDay: 50),
        q(.cyclingCadence, "Cycling Cadence", "count/min", .activity, perDay: 50),
        q(.cyclingSpeed, "Cycling Speed", "m/s", .activity, perDay: 50),
        q(.distanceSwimming, "Swimming Distance", "m", .activity, perDay: 5),
        q(.swimmingStrokeCount, "Swimming Strokes", "count", .activity, perDay: 5),
        q(.vo2Max, "VO₂ Max", "ml/kg*min", .activity, perDay: 1),
        q(.physicalEffort, "Physical Effort", "kcal/hr*kg", .activity, perDay: 100),

        // Heart
        q(.heartRate, "Heart Rate", "count/min", .heart, perDay: 3500),
        q(.restingHeartRate, "Resting Heart Rate", "count/min", .heart, perDay: 1),
        q(.walkingHeartRateAverage, "Walking HR Average", "count/min", .heart, perDay: 1),
        q(.heartRateVariabilitySDNN, "HRV (SDNN)", "ms", .heart, perDay: 8),
        q(.heartRateRecoveryOneMinute, "HR Recovery (1 min)", "count/min", .heart, perDay: 1),
        q(.atrialFibrillationBurden, "AFib Burden", "%", .heart, perDay: 1),
        q(.peripheralPerfusionIndex, "Perfusion Index", "%", .heart, perDay: 1),

        // Body
        q(.bodyMass, "Body Weight", "kg", .body, perDay: 1),
        q(.bodyMassIndex, "BMI", "count", .body, perDay: 1),
        q(.bodyFatPercentage, "Body Fat %", "%", .body, perDay: 1),
        q(.leanBodyMass, "Lean Body Mass", "kg", .body, perDay: 1),
        q(.height, "Height", "m", .body, perDay: 1),
        q(.waistCircumference, "Waist Circumference", "m", .body, perDay: 1),
        q(.bodyTemperature, "Body Temperature", "degC", .body, perDay: 1),
        q(.basalBodyTemperature, "Basal Body Temperature", "degC", .body, perDay: 1),
        q(.appleSleepingWristTemperature, "Wrist Temperature (Sleep)", "degC", .sleep, perDay: 1),

        // Respiratory / vitals
        q(.respiratoryRate, "Respiratory Rate", "count/min", .respiratory, perDay: 120),
        q(.oxygenSaturation, "Blood Oxygen", "%", .respiratory, perDay: 30),
        q(.bloodPressureSystolic, "Blood Pressure (Systolic)", "mmHg", .vitals, perDay: 2),
        q(.bloodPressureDiastolic, "Blood Pressure (Diastolic)", "mmHg", .vitals, perDay: 2),
        q(.bloodGlucose, "Blood Glucose", "mg/dL", .vitals, perDay: 10),
        q(.bloodAlcoholContent, "Blood Alcohol Content", "%", .vitals, perDay: 1),
        q(.numberOfTimesFallen, "Falls", "count", .vitals, perDay: 1),
        q(.environmentalAudioExposure, "Environmental Sound", "dBASPL", .other, perDay: 50),
        q(.headphoneAudioExposure, "Headphone Audio", "dBASPL", .other, perDay: 30),
        q(.environmentalSoundReduction, "Sound Reduction", "dBASPL", .other, perDay: 30),
        q(.timeInDaylight, "Time in Daylight", "min", .other, perDay: 20),
        q(.uvExposure, "UV Exposure", "count", .other, perDay: 5),

        // Nutrition
        q(.dietaryEnergyConsumed, "Dietary Energy", "kcal", .nutrition, perDay: 5),
        q(.dietaryProtein, "Protein", "g", .nutrition, perDay: 5),
        q(.dietaryCarbohydrates, "Carbohydrates", "g", .nutrition, perDay: 5),
        q(.dietaryFatTotal, "Total Fat", "g", .nutrition, perDay: 5),
        q(.dietaryFiber, "Fiber", "g", .nutrition, perDay: 5),
        q(.dietarySugar, "Sugar", "g", .nutrition, perDay: 5),
        q(.dietarySodium, "Sodium", "mg", .nutrition, perDay: 5),
        q(.dietaryCaffeine, "Caffeine", "mg", .nutrition, perDay: 3),
        q(.dietaryWater, "Water", "mL", .nutrition, perDay: 8),
    ]
    // workoutEffortScore / estimatedWorkoutEffortScore are deliberately absent:
    // iOS never lists them in the read-authorization sheet (FB15315876), so any
    // request containing them leaves statusForAuthorizationRequest stuck at
    // .shouldRequest and — once they're the only undetermined types — makes the
    // permission sheet flash and auto-dismiss, blocking every other pending grant.
    // Effort scores still reach the server attached to workout payloads via
    // SeriesEnricher.effortScores(for:).

    // MARK: - Category types

    private static func c(
        _ id: HKCategoryTypeIdentifier, _ name: String,
        _ group: HealthTypeDescriptor.Group, perDay: Int
    ) -> HealthTypeDescriptor {
        HealthTypeDescriptor(
            identifier: id.rawValue, displayName: name, kind: .category,
            unitString: nil, group: group, estimatedSamplesPerDay: perDay
        )
    }

    public static let categoryTypes: [HealthTypeDescriptor] = [
        c(.sleepAnalysis, "Sleep Stages", .sleep, perDay: 40),
        c(.appleStandHour, "Stand Hours", .activity, perDay: 16),
        c(.mindfulSession, "Mindful Minutes", .other, perDay: 2),
        c(.highHeartRateEvent, "High HR Events", .heart, perDay: 1),
        c(.lowHeartRateEvent, "Low HR Events", .heart, perDay: 1),
        c(.irregularHeartRhythmEvent, "Irregular Rhythm Events", .heart, perDay: 1),
        c(.lowCardioFitnessEvent, "Low Cardio Fitness Events", .heart, perDay: 1),
        c(.handwashingEvent, "Handwashing Events", .other, perDay: 5),
        c(.toothbrushingEvent, "Toothbrushing Events", .other, perDay: 2),
        c(.environmentalAudioExposureEvent, "Loud Environment Events", .other, perDay: 1),
        c(.headphoneAudioExposureEvent, "Loud Headphone Events", .other, perDay: 1),
    ] + ios18CategoryTypes

    private static let ios18CategoryTypes: [HealthTypeDescriptor] = {
        guard #available(iOS 18.0, *) else { return [] }
        return [
            c(.sleepApneaEvent, "Sleep Apnea Events", .sleep, perDay: 1),
        ]
    }()
}
