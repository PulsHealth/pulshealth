import Foundation
import HealthKit

/// Converts HealthKit objects into Sendable wire DTOs. Conversion happens as soon as
/// samples come off a query so the rest of the pipeline never touches HKObject.
enum SampleMapper {
    static func map(_ sample: HKSample, descriptor: HealthTypeDescriptor) -> SyncSample? {
        let startContext = temporalContext(for: sample.startDate, metadata: sample.metadata)
        let endContext = temporalContext(for: sample.endDate, metadata: sample.metadata)
        var dto = SyncSample(
            uuid: sample.uuid,
            type: descriptor.identifier,
            kind: descriptor.kind,
            start: sample.startDate,
            end: sample.endDate,
            startContext: startContext,
            endContext: endContext,
            sourceName: sample.sourceRevision.source.name,
            sourceBundleID: sample.sourceRevision.source.bundleIdentifier,
            sourceVersion: sample.sourceRevision.version,
            device: sample.device.flatMap { $0.name ?? $0.model },
            metadata: mapMetadata(sample.metadata)
        )

        switch descriptor.kind {
        case .quantity:
            guard let quantity = (sample as? HKQuantitySample)?.quantity,
                  let unit = descriptor.unit, quantity.is(compatibleWith: unit) else { return nil }
            dto.value = quantity.doubleValue(for: unit)
            dto.unit = descriptor.unitString
        case .category:
            guard let category = sample as? HKCategorySample else { return nil }
            dto.category = category.value
        case .workout:
            guard let workout = sample as? HKWorkout else { return nil }
            dto.workout = mapWorkout(workout)
        case .heartbeatSeries:
            // Beat offsets need a follow-up HKHeartbeatSeriesQuery; the engine's
            // SeriesEnricher fills them in before upload.
            guard sample is HKHeartbeatSeriesSample else { return nil }
            dto.heartbeats = []
        case .ecg:
            // Voltage trace is filled in by SeriesEnricher; the classification and
            // rates live on the sample itself.
            guard let ecg = sample as? HKElectrocardiogram else { return nil }
            dto.ecg = ECGDetail(
                classification: ecg.classification.pulsName,
                averageHeartRateBpm: ecg.averageHeartRate?
                    .doubleValue(for: HKUnit.count().unitDivided(by: .minute())),
                samplingFrequencyHz: ecg.samplingFrequency?.doubleValue(for: .hertz()),
                symptomsStatus: ecg.symptomsStatus.pulsName,
                voltagesUV: []
            )
        case .stateOfMind:
            guard #available(iOS 18.0, *), let som = sample as? HKStateOfMind else { return nil }
            dto.stateOfMind = StateOfMindDetail(
                kind: som.kind.pulsName,
                valence: som.valence,
                valenceClassification: som.valenceClassification.pulsName,
                labels: som.labels.map(\.pulsName),
                associations: som.associations.map(\.pulsName)
            )
        case .medicationDose:
            guard #available(iOS 26.0, *), let dose = sample as? HKMedicationDoseEvent else { return nil }
            dto.medicationDose = MedicationDoseDetail(
                medication: String(describing: dose.medicationConceptIdentifier),
                status: dose.logStatus.pulsName,
                scheduledAt: dose.scheduledDate,
                scheduledAtContext: dose.scheduledDate.map {
                    temporalContext(for: $0, metadata: sample.metadata)
                },
                doseQuantity: dose.doseQuantity ?? dose.scheduledDoseQuantity,
                doseUnit: dose.unit.unitString
            )
        case .activitySummary:
            // Activity summaries are not HKSamples; they're exported via
            // HKActivitySummaryQuery in ActivitySummarySync, never mapped here.
            return nil
        }
        return dto
    }

    private static func mapWorkout(_ workout: HKWorkout) -> WorkoutDetail {
        let detail = statisticsDetail(from: workout.allStatistics)
        // Flat back-compat map: representative value (sum for cumulative, avg for discrete).
        var stats: [String: Double] = [:]
        for (id, stat) in detail {
            if let v = stat.sum ?? stat.avg { stats[id] = v }
        }

        let energy = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?
            .sumQuantity()?.doubleValue(for: .kilocalorie())
        let distance = workout.statistics(for: HKQuantityType(.distanceWalkingRunning))?
            .sumQuantity()?.doubleValue(for: .meter())
            ?? workout.statistics(for: HKQuantityType(.distanceCycling))?
            .sumQuantity()?.doubleValue(for: .meter())

        let events: [WorkoutEvent]? = (workout.workoutEvents ?? []).map { event in
            WorkoutEvent(
                type: event.type.pulsName,
                start: event.dateInterval.start,
                end: event.dateInterval.duration > 0 ? event.dateInterval.end : nil,
                startContext: temporalContext(
                    for: event.dateInterval.start,
                    metadata: event.metadata ?? workout.metadata
                ),
                endContext: event.dateInterval.duration > 0
                    ? temporalContext(for: event.dateInterval.end, metadata: event.metadata ?? workout.metadata)
                    : nil,
                metadata: mapMetadata(event.metadata)
            )
        }

        // Multi-sport / interval workouts expose ordered sub-activities (iOS 16+,
        // always available at the iOS 17 baseline). Empty for simple workouts.
        let activities: [WorkoutActivitySegment]? = workout.workoutActivities.map { activity in
            let actStats = statisticsDetail(from: activity.allStatistics)
            return WorkoutActivitySegment(
                activityType: activity.workoutConfiguration.activityType.pulsName,
                start: activity.startDate,
                end: activity.endDate,
                startContext: temporalContext(for: activity.startDate, metadata: workout.metadata),
                endContext: activity.endDate.map {
                    temporalContext(for: $0, metadata: workout.metadata)
                },
                duration: activity.duration,
                statistics: actStats.isEmpty ? nil : actStats
            )
        }

        return WorkoutDetail(
            activityType: workout.workoutActivityType.pulsName,
            duration: workout.duration,
            totalEnergyKcal: energy,
            totalDistanceMeters: distance,
            statistics: stats.isEmpty ? nil : stats,
            statisticsDetail: detail.isEmpty ? nil : detail,
            events: (events?.isEmpty ?? true) ? nil : events,
            activities: (activities?.isEmpty ?? true) ? nil : activities
        )
    }

    /// Builds per-type min/avg/max/sum aggregates in each type's canonical unit,
    /// skipping types not in the catalog (no canonical unit to convert to).
    static func statisticsDetail(from all: [HKQuantityType: HKStatistics]) -> [String: WorkoutStat] {
        var out: [String: WorkoutStat] = [:]
        for (type, stat) in all {
            guard let descriptor = HealthTypeCatalog.descriptor(for: type.identifier),
                  let unit = descriptor.unit else { continue }
            func conv(_ q: HKQuantity?) -> Double? {
                guard let q, q.is(compatibleWith: unit) else { return nil }
                return q.doubleValue(for: unit)
            }
            let s = WorkoutStat(
                min: conv(stat.minimumQuantity()), avg: conv(stat.averageQuantity()),
                max: conv(stat.maximumQuantity()), sum: conv(stat.sumQuantity())
            )
            if !s.isEmpty { out[type.identifier] = s }
        }
        return out
    }

    static func mapMetadata(_ metadata: [String: Any]?) -> [String: MetadataValue]? {
        guard let metadata, !metadata.isEmpty else { return nil }
        var out: [String: MetadataValue] = [:]
        for (key, raw) in metadata {
            switch raw {
            case let v as NSNumber:
                // Swift bridges *any* NSNumber holding 0 or 1 to Bool, so a
                // `case let v as Bool` first would turn integer metadata such as
                // HKMetadataKeyHeartRateMotionContext (0/1/2) into true/false/2.
                // Only a CFBoolean is a real boolean; Swift Bool/Int/Double
                // values all bridge through NSNumber here too.
                if CFGetTypeID(v) == CFBooleanGetTypeID() {
                    out[key] = .bool(v.boolValue)
                } else {
                    out[key] = .number(v.doubleValue)
                }
            case let v as String: out[key] = .string(v)
            case let v as Date: out[key] = .date(v)
            case let v as HKQuantity:
                // Try a few common units; fall back to description.
                for unit in [HKUnit.percent(), .count(), .meter(), .degreeCelsius(),
                             .millimeterOfMercury(), .decibelAWeightedSoundPressureLevel()]
                where v.is(compatibleWith: unit) {
                    out[key] = .number(v.doubleValue(for: unit))
                    break
                }
                if out[key] == nil { out[key] = .string(String(describing: v)) }
            default:
                out[key] = .string(String(describing: raw))
            }
        }
        return out.isEmpty ? nil : out
    }

    private static func temporalContext(
        for date: Date,
        metadata: [String: Any]?
    ) -> TemporalContext {
        if let zone = timeZone(from: metadata) {
            return TemporalContext(
                timeZoneID: zone.identifier,
                utcOffsetSeconds: zone.secondsFromGMT(for: date),
                source: "healthkit_metadata",
                confidence: "recorded"
            )
        }
        return .deviceCurrent(for: date)
    }

    private static func timeZone(from metadata: [String: Any]?) -> TimeZone? {
        guard let raw = metadata?[HKMetadataKeyTimeZone] else { return nil }
        if let zone = raw as? TimeZone {
            return zone
        }
        if let zone = raw as? NSTimeZone {
            return zone as TimeZone
        }
        if let id = raw as? String {
            return TimeZone(identifier: id)
        }
        return nil
    }
}

extension HKWorkoutActivityType {
    /// Human-readable name for the wire format (stable across releases).
    var pulsName: String {
        switch self {
        case .running: return "running"
        case .walking: return "walking"
        case .cycling: return "cycling"
        case .hiking: return "hiking"
        case .swimming: return "swimming"
        case .traditionalStrengthTraining: return "strength_training"
        case .functionalStrengthTraining: return "functional_strength_training"
        case .highIntensityIntervalTraining: return "hiit"
        case .yoga: return "yoga"
        case .pilates: return "pilates"
        case .rowing: return "rowing"
        case .elliptical: return "elliptical"
        case .stairClimbing: return "stair_climbing"
        case .coreTraining: return "core_training"
        case .crossTraining: return "cross_training"
        case .flexibility: return "flexibility"
        case .mixedCardio: return "mixed_cardio"
        case .danceInspiredTraining, .cardioDance, .socialDance: return "dance"
        case .tennis: return "tennis"
        case .basketball: return "basketball"
        case .soccer: return "soccer"
        case .golf: return "golf"
        case .skatingSports: return "skating"
        case .snowSports, .downhillSkiing, .crossCountrySkiing, .snowboarding: return "snow_sports"
        case .surfingSports: return "surfing"
        case .paddleSports: return "paddle_sports"
        case .climbing: return "climbing"
        case .equestrianSports: return "equestrian"
        case .fishing: return "fishing"
        case .hunting: return "hunting"
        case .play: return "play"
        case .preparationAndRecovery: return "recovery"
        case .wheelchairWalkPace: return "wheelchair_walk"
        case .wheelchairRunPace: return "wheelchair_run"
        case .taiChi: return "tai_chi"
        case .handCycling: return "hand_cycling"
        case .discSports: return "disc_sports"
        case .fitnessGaming: return "fitness_gaming"
        case .cooldown: return "cooldown"
        case .pickleball: return "pickleball"
        case .swimBikeRun: return "triathlon"
        case .transition: return "transition"
        case .underwaterDiving: return "diving"
        case .other: return "other"
        default: return "activity_\(rawValue)"
        }
    }
}

extension HKWorkoutEventType {
    /// Stable wire string for a workout event marker.
    var pulsName: String {
        switch self {
        case .pause: return "pause"
        case .resume: return "resume"
        case .lap: return "lap"
        case .marker: return "marker"
        case .motionPaused: return "motionPaused"
        case .motionResumed: return "motionResumed"
        case .segment: return "segment"
        case .pauseOrResumeRequest: return "pauseOrResumeRequest"
        @unknown default: return "event_\(rawValue)"
        }
    }
}

extension HKElectrocardiogram.Classification {
    /// Stable wire string.
    var pulsName: String {
        switch self {
        case .notSet: return "notSet"
        case .sinusRhythm: return "sinusRhythm"
        case .atrialFibrillation: return "atrialFibrillation"
        case .inconclusiveLowHeartRate: return "inconclusiveLowHeartRate"
        case .inconclusiveHighHeartRate: return "inconclusiveHighHeartRate"
        case .inconclusivePoorReading: return "inconclusivePoorReading"
        case .inconclusiveOther: return "inconclusiveOther"
        case .unrecognized: return "unrecognized"
        @unknown default: return "classification_\(rawValue)"
        }
    }
}

extension HKElectrocardiogram.SymptomsStatus {
    var pulsName: String {
        switch self {
        case .notSet: return "notSet"
        case .none: return "none"
        case .present: return "present"
        @unknown default: return "status_\(rawValue)"
        }
    }
}

@available(iOS 18.0, *)
extension HKStateOfMind.Kind {
    var pulsName: String {
        switch self {
        case .momentaryEmotion: return "momentaryEmotion"
        case .dailyMood: return "dailyMood"
        @unknown default: return "kind_\(rawValue)"
        }
    }
}

@available(iOS 18.0, *)
extension HKStateOfMind.ValenceClassification {
    var pulsName: String {
        switch self {
        case .veryUnpleasant: return "veryUnpleasant"
        case .unpleasant: return "unpleasant"
        case .slightlyUnpleasant: return "slightlyUnpleasant"
        case .neutral: return "neutral"
        case .slightlyPleasant: return "slightlyPleasant"
        case .pleasant: return "pleasant"
        case .veryPleasant: return "veryPleasant"
        @unknown default: return "valence_\(rawValue)"
        }
    }
}

@available(iOS 18.0, *)
extension HKStateOfMind.Label {
    var pulsName: String {
        switch self {
        case .amazed: return "amazed"
        case .amused: return "amused"
        case .angry: return "angry"
        case .anxious: return "anxious"
        case .ashamed: return "ashamed"
        case .brave: return "brave"
        case .calm: return "calm"
        case .content: return "content"
        case .disappointed: return "disappointed"
        case .discouraged: return "discouraged"
        case .disgusted: return "disgusted"
        case .embarrassed: return "embarrassed"
        case .excited: return "excited"
        case .frustrated: return "frustrated"
        case .grateful: return "grateful"
        case .guilty: return "guilty"
        case .happy: return "happy"
        case .hopeless: return "hopeless"
        case .irritated: return "irritated"
        case .jealous: return "jealous"
        case .joyful: return "joyful"
        case .lonely: return "lonely"
        case .passionate: return "passionate"
        case .peaceful: return "peaceful"
        case .proud: return "proud"
        case .relieved: return "relieved"
        case .sad: return "sad"
        case .scared: return "scared"
        case .stressed: return "stressed"
        case .surprised: return "surprised"
        case .worried: return "worried"
        case .annoyed: return "annoyed"
        case .confident: return "confident"
        case .drained: return "drained"
        case .hopeful: return "hopeful"
        case .indifferent: return "indifferent"
        case .overwhelmed: return "overwhelmed"
        case .satisfied: return "satisfied"
        @unknown default: return "label_\(rawValue)"
        }
    }
}

@available(iOS 18.0, *)
extension HKStateOfMind.Association {
    var pulsName: String {
        switch self {
        case .community: return "community"
        case .currentEvents: return "currentEvents"
        case .dating: return "dating"
        case .education: return "education"
        case .family: return "family"
        case .fitness: return "fitness"
        case .friends: return "friends"
        case .health: return "health"
        case .hobbies: return "hobbies"
        case .identity: return "identity"
        case .money: return "money"
        case .partner: return "partner"
        case .selfCare: return "selfCare"
        case .spirituality: return "spirituality"
        case .tasks: return "tasks"
        case .travel: return "travel"
        case .work: return "work"
        case .weather: return "weather"
        @unknown default: return "association_\(rawValue)"
        }
    }
}

@available(iOS 26.0, *)
extension HKMedicationDoseEvent.LogStatus {
    var pulsName: String {
        switch self {
        case .notInteracted: return "notInteracted"
        case .notificationNotSent: return "notificationNotSent"
        case .snoozed: return "snoozed"
        case .taken: return "taken"
        case .skipped: return "skipped"
        case .notLogged: return "notLogged"
        @unknown default: return "status_\(rawValue)"
        }
    }
}
