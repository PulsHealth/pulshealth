import Foundation
import HealthKit
import Testing
@testable import PulsHealthSync

/// The legacy reader crashed inside `HKQuantity.doubleValue(for:)` when its
/// requested unit was incompatible. Exercise its current replacements with
/// real quantities: Swift error handling cannot catch that Objective-C exception.
@Suite struct QuantityConversionSafetyTests {
    private let date = Date(timeIntervalSince1970: 1_767_225_600)

    private func descriptor(unit: String?) -> HealthTypeDescriptor {
        HealthTypeDescriptor(
            identifier: HKQuantityTypeIdentifier.distanceWalkingRunning.rawValue,
            displayName: "Distance", kind: .quantity, unitString: unit,
            group: .activity, estimatedSamplesPerDay: 1, minimumIOS: .baseline)
    }

    private func sample(value: Double = 1.25) -> HKQuantitySample {
        HKQuantitySample(
            type: HKQuantityType(.distanceWalkingRunning),
            quantity: HKQuantity(unit: .meterUnit(with: .kilo), doubleValue: value),
            start: date, end: date.addingTimeInterval(60))
    }

    @Test(arguments: ["count", "kg", "degC", "count/min"])
    func incompatibleCanonicalUnitDoesNotCrashOrInventAValue(unit: String) {
        let descriptor = descriptor(unit: unit)
        let sample = sample()
        #expect(SampleMapper.map(sample, descriptor: descriptor) == nil)

        let scanned = SampleScanner.reduce(sample, descriptor: descriptor)
        #expect(scanned.uuid == sample.uuid)
        #expect(scanned.hasQuantity)
        #expect(scanned.value == nil)

        // The failed conversion remains visible to Explore as a raw sample
        // and an unmappable quantity, rather than appearing to be no data.
        var accumulator = ProfileAccumulator(
            typeIdentifier: descriptor.identifier, kind: .quantity,
            unitString: unit, histogramBins: 4, reservoirCapacity: 10,
            calendar: Calendar(identifier: .gregorian), seed: 1)
        accumulator.add(scanned)
        let profile = accumulator.finish(
            computedAt: date, scanDuration: 0, rangeStart: nil, rangeEnd: nil,
            isComplete: true, failureReason: nil)
        #expect(profile.sampleCount == 1)
        #expect(profile.unmappableCount == 1)
        #expect(profile.values == nil)
    }

    @Test func missingCanonicalUnitDoesNotFallBackToRawValue() {
        let descriptor = descriptor(unit: nil)
        let sample = sample()
        #expect(SampleMapper.map(sample, descriptor: descriptor) == nil)
        let scanned = SampleScanner.reduce(sample, descriptor: descriptor)
        #expect(scanned.hasQuantity)
        #expect(scanned.value == nil)
    }

    @Test(arguments: [0.0, 1.25, 42.0])
    func validQuantitiesConvertToCanonicalMeters(value: Double) throws {
        let descriptor = descriptor(unit: "m")
        let sample = sample(value: value)
        let mapped = try #require(SampleMapper.map(sample, descriptor: descriptor))
        #expect(mapped.uuid == sample.uuid)
        #expect(mapped.type == descriptor.identifier)
        #expect(mapped.unit == "m")
        #expect(mapped.value == value * 1_000)
        let scanned = SampleScanner.reduce(sample, descriptor: descriptor)
        #expect(scanned.hasQuantity)
        #expect(scanned.value == mapped.value)
    }
}
