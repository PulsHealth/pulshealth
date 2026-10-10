import XCTest
@testable import PulsHealth

final class HistogramChartTests: XCTestCase {
    func testDisjointTypicalRangeDoesNotConstructReversedBounds() {
        // The App Store 1.6 crash occurred while constructing this band.
        XCTAssertNil(HistogramChart.referenceBand(typicalRange: 60...100, lowerBound: 110, upperBound: 140))
        XCTAssertNil(HistogramChart.referenceBand(typicalRange: 60...100, lowerBound: 20, upperBound: 50))
    }

    func testMissingOrZeroWidthOverlapHasNoBand() {
        XCTAssertNil(HistogramChart.referenceBand(typicalRange: nil, lowerBound: 20, upperBound: 50))
        XCTAssertNil(HistogramChart.referenceBand(typicalRange: 60...100, lowerBound: 100, upperBound: 140))
        XCTAssertNil(HistogramChart.referenceBand(typicalRange: 60...100, lowerBound: 20, upperBound: 60))
        XCTAssertNil(HistogramChart.referenceBand(typicalRange: 60...100, lowerBound: 80, upperBound: 80))
    }

    func testOverlappingBandIsClippedToHistogram() {
        XCTAssertEqual(HistogramChart.referenceBand(typicalRange: 60...100, lowerBound: 80, upperBound: 140), 80...100)
        XCTAssertEqual(HistogramChart.referenceBand(typicalRange: 60...100, lowerBound: 20, upperBound: 80), 60...80)
        XCTAssertEqual(HistogramChart.referenceBand(typicalRange: 60...100, lowerBound: 70, upperBound: 90), 70...90)
        XCTAssertEqual(HistogramChart.referenceBand(typicalRange: 60...100, lowerBound: 20, upperBound: 140), 60...100)
    }
}
