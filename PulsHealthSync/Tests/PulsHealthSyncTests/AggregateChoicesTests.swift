import Foundation
import Testing
@testable import PulsHealthSync

private let steps = "HKQuantityTypeIdentifierStepCount"
private let heartRate = "HKQuantityTypeIdentifierHeartRate"
private let weight = "HKQuantityTypeIdentifierBodyMass"
private let sleep = "HKCategoryTypeIdentifierSleepAnalysis"

@Suite struct AggregateChoicesTests {
    // MARK: - Daily default

    @Test func dailyDefaultIsATotalOrAnAverageOverOneDayFromEveryDevice() throws {
        let total = try #require(AggregateConfig.dailyDefault(for: steps))
        #expect(total.function == .sum)
        #expect(total.intervalValue == 1 && total.intervalUnit == .day && total.deviceFilter == .all)
        #expect(total.startDate == nil && total.enabled)

        let average = try #require(AggregateConfig.dailyDefault(for: heartRate))
        #expect(average.function == .average)
        #expect(average.intervalValue == 1 && average.intervalUnit == .day && average.deviceFilter == .all)

        #expect(AggregateConfig.dailyDefault(for: sleep) == nil)
        #expect(AggregateConfig.dailyDefault(for: HealthTypeCatalog.workoutIdentifier) == nil)
        #expect(AggregateConfig.dailyDefault(for: "NotAType") == nil)
    }

    @Test func everyMeasurementHasALegalDailyDefault() throws {
        #expect(!AggregateList.measurementTypes.isEmpty)
        for descriptor in AggregateList.measurementTypes {
            let daily = try #require(AggregateConfig.dailyDefault(for: descriptor.identifier))
            #expect(HealthTypeCatalog.allowedAggregateFunctions(for: descriptor.identifier).contains(daily.function))
        }
        #expect(AggregateList.measurementTypes.allSatisfy { $0.kind == .quantity })
    }

    @Test func theDailyDefaultIsRecognisedWhateverItsIdAndOptions() throws {
        var daily = try #require(AggregateConfig.dailyDefault(for: steps))
        daily.startDate = Date(timeIntervalSince1970: 0)
        daily.settleDelay = 0
        #expect(daily.isDailyDefault)
        #expect(!daily.with(interval: (1, .hour)).isDailyDefault)
        #expect(!daily.with(deviceFilter: .watch).isDailyDefault)
        #expect(!AggregateConfig(typeIdentifier: heartRate, function: .max).isDailyDefault)
    }

    // MARK: - Words

    @Test func labelsReadAsPlainWords() {
        func label(_ type: String, _ function: AggregateFunction, _ value: Int, _ unit: AggregateIntervalUnit,
                   _ devices: AggregateDeviceFilter = .all) -> String {
            AggregateConfig(typeIdentifier: type, function: function, intervalValue: value,
                            intervalUnit: unit, deviceFilter: devices).label
        }
        #expect(label(steps, .sum, 1, .day) == "Daily total")
        #expect(label(heartRate, .average, 1, .hour) == "Hourly average")
        #expect(label(heartRate, .max, 1, .day, .watch) == "Daily maximum · Apple Watch")
        #expect(label(steps, .sum, 1, .day, .iphone) == "Daily total · iPhone")
        #expect(label(heartRate, .min, 1, .week) == "Weekly minimum")
        #expect(label(weight, .average, 1, .month) == "Monthly average")
        #expect(label(weight, .mostRecent, 1, .day) == "Latest each day")
        #expect(label(heartRate, .average, 5, .minute) == "Average every 5 minutes")
        #expect(label(heartRate, .average, 1, .minute) == "Average every minute")
        #expect(label(steps, .sum, 2, .day) == "Total every 2 days")
        #expect(label(weight, .mostRecent, 3, .hour) == "Latest every 3 hours")
        #expect(label(steps, .duration, 1, .day) == "Daily duration")
    }

    @Test func choicesAreLegalAndLeaveDurationOut() {
        #expect(AggregateFunction.choices(for: steps) == [.sum, .mostRecent])
        #expect(AggregateFunction.choices(for: heartRate) == [.average, .min, .max, .mostRecent])
        #expect(AggregateFunction.choices(for: sleep).isEmpty)
        #expect(AggregateIntervalUnit.choices == [.hour, .day, .week, .month])
    }

    @Test func summariesNameOneOrTwoAndCountTheRest() throws {
        var list = AggregateList([])
        #expect(list.summary(for: heartRate) == nil)
        list.add(AggregateConfig(typeIdentifier: heartRate, function: .average, intervalUnit: .hour))
        #expect(list.summary(for: heartRate) == "Hourly average")
        list.addType(heartRate) // already aggregated: nothing added
        #expect(list.configs.count == 1)
        list.addDailyDefaults(for: [heartRate])
        // The daily default leads, whatever order the configs were added in.
        #expect(list.summary(for: heartRate) == "Daily average, hourly average")
        list.add(AggregateConfig(typeIdentifier: heartRate, function: .max))
        #expect(list.summary(for: heartRate) == "Daily average + 2 more")
        #expect(list.configs(for: heartRate).first?.isDailyDefault == true)
    }

    @Test func approximateValueCountIsOnePerInterval() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let daily = AggregateConfig(typeIdentifier: steps, function: .sum)
        #expect(daily.approximateValueCount(from: start, to: start.addingTimeInterval(30 * 86_400)) == 30)
        #expect(daily.approximateValueCount(from: start, to: start.addingTimeInterval(30.5 * 86_400)) == 31)
        let hourly = daily.with(interval: (1, .hour))
        #expect(hourly.approximateValueCount(from: start, to: start.addingTimeInterval(86_400)) == 24)
        #expect(daily.approximateValueCount(from: start, to: start) == 0)
    }

    // MARK: - Suggestions

    @Test func suggestionsForACumulativeType() throws {
        var list = AggregateList([])
        list.addType(steps)
        let labels = list.suggestions(for: steps).map(\.label)
        #expect(labels == [
            "Hourly total", "Weekly total", "Monthly total",
            "Daily total · Apple Watch", "Daily total · iPhone",
        ])
    }

    @Test func suggestionsForADiscreteType() throws {
        var list = AggregateList([])
        list.addType(heartRate)
        let labels = list.suggestions(for: heartRate).map(\.label)
        #expect(labels == [
            "Hourly average", "Daily minimum", "Daily maximum", "Weekly average", "Monthly average",
        ])
    }

    @Test func suggestionsOfferTheMissingDailyDefaultFirstAndHideWhatIsThere() throws {
        var list = AggregateList([AggregateConfig(typeIdentifier: steps, function: .sum, intervalUnit: .week)])
        let labels = list.suggestions(for: steps).map(\.label)
        #expect(labels.first == "Daily total")
        #expect(!labels.contains("Weekly total"))
        let daily = try #require(list.suggestions(for: steps).first)
        list.add(daily)
        #expect(!list.suggestions(for: steps).map(\.label).contains("Daily total"))
        #expect(AggregateList([]).suggestions(for: sleep).isEmpty)
    }

    @Test func everySuggestionIsLegalForEveryMeasurement() {
        for descriptor in AggregateList.measurementTypes {
            let allowed = HealthTypeCatalog.allowedAggregateFunctions(for: descriptor.identifier)
            let suggestions = AggregateList([]).suggestions(for: descriptor.identifier)
            #expect(!suggestions.isEmpty)
            for suggestion in suggestions {
                #expect(allowed.contains(suggestion.function), "\(descriptor.identifier) \(suggestion.function)")
                #expect(suggestion.typeIdentifier == descriptor.identifier)
            }
            #expect(Set(suggestions.map(\.seriesIdentity)).count == suggestions.count)
        }
    }

    // MARK: - Edits

    @Test func addingATypeGivesItsDailyDefaultAndRemovingItRemovesEverything() throws {
        var list = AggregateList([])
        let added = list.addType(steps)
        let again = list.addType(steps)
        let notAMeasurement = list.addType(sleep)
        #expect(added && !again && !notAMeasurement)
        #expect(list.configs.count == 1 && list.configs[0].isDailyDefault)
        #expect(!list.hasMoreThanDefault(type: steps))

        list.add(AggregateConfig(typeIdentifier: steps, function: .sum, intervalUnit: .hour))
        #expect(list.hasMoreThanDefault(type: steps))
        list.addType(heartRate)
        list.removeType(steps)
        #expect(list.typeIdentifiers == [heartRate])
    }

    @Test func aChangedDefaultCountsAsMoreThanTheDefault() throws {
        var list = AggregateList([])
        list.addType(steps)
        list.configs[0].startDate = Date(timeIntervalSince1970: 0)
        #expect(list.hasMoreThanDefault(type: steps))
    }

    @Test func duplicatesAreRefused() throws {
        var list = AggregateList([])
        list.addType(steps)
        let hourly = AggregateConfig(typeIdentifier: steps, function: .sum, intervalUnit: .hour)
        let first = list.add(hourly)
        let second = list.add(AggregateConfig(typeIdentifier: steps, function: .sum, intervalUnit: .hour))
        #expect(first && !second)
        // Turning the hourly total into a second daily total is refused.
        #expect(list.duplicates(hourly.with(interval: (1, .day))))
        let collided = list.update(hourly.with(interval: (1, .day)))
        #expect(!collided)
        // A real change keeps the id, so the sync sees the same config re-identified.
        let changed = list.update(hourly.with(interval: (1, .week)))
        #expect(changed)
        #expect(list.configs.first { $0.id == hourly.id }?.intervalUnit == .week)
        list.remove(id: hourly.id)
        #expect(list.configs.count == 1)
    }

    @Test func matchRawSamplesAddsOnlyMissingDailyDefaultsForMeasurements() throws {
        var list = AggregateList([AggregateConfig(typeIdentifier: heartRate, function: .max)])
        list.addType(weight)
        let raw: Set<String> = [steps, heartRate, weight, sleep, HealthTypeCatalog.workoutIdentifier]
        #expect(list.missingDailyDefaults(for: raw) == 2)
        let added = list.addDailyDefaults(for: raw)
        #expect(added == 2)
        #expect(list.typeIdentifiers == [steps, heartRate, weight])
        #expect(list.configs(for: heartRate).count == 2, "keeps the maximum, adds the average")
        let none = list.addDailyDefaults(for: raw)
        #expect(none == 0)
    }

    @Test func allMeasurementsGivesEveryMeasurementItsDefault() {
        var list = AggregateList([])
        let added = list.addDailyDefaults(for: AggregateList.measurementTypes.map(\.identifier))
        #expect(added == AggregateList.measurementTypes.count)
        #expect(list.configs.allSatisfy { $0.isDailyDefault })
    }

    @Test func changedTypesCountsTypesNotConfigs() throws {
        var list = AggregateList([])
        list.addType(steps)
        list.addType(heartRate)
        let applied = list.configs
        #expect(AggregateList.changedTypes(from: applied, to: applied).isEmpty)
        list.add(AggregateConfig(typeIdentifier: heartRate, function: .max))
        list.add(AggregateConfig(typeIdentifier: heartRate, function: .min))
        list.addType(weight)
        #expect(AggregateList.changedTypes(from: applied, to: list.configs) == [heartRate, weight])
        list.removeType(steps)
        #expect(AggregateList.changedTypes(from: applied, to: list.configs) == [steps, heartRate, weight])
    }

    // MARK: - Progress

    @Test func progressReadsTheSyncState() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let daily = AggregateConfig(typeIdentifier: steps, function: .sum)
        var state = AggregateSyncState(configID: daily.id)
        #expect(AggregateProgress(config: daily, state: nil, now: now) == .notSynced)
        #expect(AggregateProgress(config: daily, state: state, now: now) == .notSynced)

        var off = daily
        off.enabled = false
        #expect(AggregateProgress(config: off, state: state, now: now) == .off)

        // A first pass under way.
        state.fullRecomputeStartedAt = now.addingTimeInterval(-600)
        state.computedThrough = now.addingTimeInterval(-400 * 86_400)
        #expect(AggregateProgress(config: daily, state: state, now: now) == .catchingUp(through: state.computedThrough))

        // Done: current within a day plus settling.
        state.fullRecomputeStartedAt = nil
        state.lastFullRecomputeAt = now
        state.computedThrough = now.addingTimeInterval(-20 * 3_600)
        #expect(AggregateProgress(config: daily, state: state, now: now) == .upToDate)

        // The monthly repair pass does not make a current series look behind.
        state.fullRecomputeStartedAt = now
        #expect(AggregateProgress(config: daily, state: state, now: now) == .upToDate)

        state.computedThrough = now.addingTimeInterval(-5 * 86_400)
        let through = try #require(state.computedThrough)
        #expect(AggregateProgress(config: daily, state: state, now: now) == .behind(through: through))

        state.lastError = "Refused"
        #expect(AggregateProgress(config: daily, state: state, now: now) == .failed("Refused"))
    }
}
