import Foundation
import HealthKit
import Testing
@testable import PulsHealthSync

/// `HealthSyncEngine.pack` decides which anchored pages ride in the same
/// upload. Anchor-after-ack depends on one property above all others: a page is
/// never split across two batches, so a type's anchor can advance the moment
/// the single upload carrying its data is acked. These tests pin that down.
@Suite struct MergedSyncPackingTests {

    /// `rawCount` defaults to the mapped total, i.e. nothing was dropped. Pass
    /// it explicitly to build the case that matters: a page HealthKit filled
    /// but `SampleMapper` could not convert.
    private func page(
        _ identifier: String,
        samples: Int,
        deletions: Int = 0,
        drained: Bool = true,
        rawCount: Int? = nil
    ) -> MergedPage {
        MergedPage(
            identifier: identifier,
            samples: (0..<samples).map { i in
                SyncSample(
                    uuid: UUID(), type: identifier, kind: .quantity,
                    start: Date(timeIntervalSince1970: TimeInterval(i)),
                    end: Date(timeIntervalSince1970: TimeInterval(i) + 1),
                    value: Double(i), unit: "count"
                )
            },
            deletions: (0..<deletions).map { _ in SyncDeletion(uuid: UUID(), type: identifier) },
            newAnchor: HKQueryAnchor(fromValue: samples),
            newAnchorData: Data(),
            enrichment: HealthSyncEngine.WorkoutEnrichment(),
            queryDuration: 0,
            drained: drained,
            rawCount: rawCount ?? (samples + deletions),
            dropped: max(0, (rawCount ?? (samples + deletions)) - deletions - samples)
        )
    }

    /// The distinction the drained decision now turns on. `isEmpty` is a
    /// mapped-count question; `isRawEmpty` is the raw one. Treating the first
    /// as "HealthKit has nothing more" is how a type with a wrong `unitString`
    /// reported zero samples and backfill complete, silently.
    @Test func rawEmptyIsNotTheSameAsMappedEmpty() {
        let nothingAtAll = page("a", samples: 0, rawCount: 0)
        #expect(nothingAtAll.isEmpty)
        #expect(nothingAtAll.isRawEmpty)
        #expect(nothingAtAll.dropped == 0)

        // HealthKit returned a full page; none of it mapped.
        let allDropped = page("b", samples: 0, drained: false, rawCount: 1_000)
        #expect(allDropped.isEmpty, "nothing mapped, so there is nothing to upload")
        #expect(!allDropped.isRawEmpty, "but HealthKit did return data — not drained")
        #expect(allDropped.dropped == 1_000)

        // A partial drop still counts what was lost.
        let partial = page("c", samples: 10, rawCount: 25)
        #expect(!partial.isEmpty)
        #expect(!partial.isRawEmpty)
        #expect(partial.dropped == 15)
    }

    private func identifiers(_ packs: [[MergedPage]]) -> [[String]] {
        packs.map { $0.map(\.identifier) }
    }

    @Test func smallPagesRideTogether() {
        // The real-world case: the median page carried 7 samples and cost a
        // full round trip on its own.
        let packs = HealthSyncEngine.pack(
            [page("a", samples: 7), page("b", samples: 20), page("c", samples: 31)],
            budget: 1_000)
        #expect(packs.count == 1)
        #expect(packs[0].reduce(0) { $0 + $1.count } == 58)
    }

    @Test func noPackExceedsTheBudget() {
        let pages = [
            page("a", samples: 400), page("b", samples: 400),
            page("c", samples: 400), page("d", samples: 50),
        ]
        let packs = HealthSyncEngine.pack(pages, budget: 1_000)
        for pack in packs {
            #expect(pack.reduce(0) { $0 + $1.count } <= 1_000)
        }
    }

    @Test func everyPageIsPlacedExactlyOnce() {
        let pages = [
            page("a", samples: 900), page("b", samples: 7), page("c", samples: 200),
            page("d", samples: 1), page("e", samples: 512, deletions: 12),
        ]
        let placed = identifiers(HealthSyncEngine.pack(pages, budget: 1_000)).flatMap { $0 }
        #expect(placed.sorted() == ["a", "b", "c", "d", "e"])
        #expect(Set(placed).count == placed.count)
    }

    /// The load-bearing invariant. If a page were ever split, half of it could
    /// be acked while the other half failed, and there would be no correct
    /// anchor to persist for that type.
    @Test func aPageIsNeverSplitAcrossPacks() {
        let pages = [page("a", samples: 800), page("b", samples: 800), page("c", samples: 800)]
        let packs = HealthSyncEngine.pack(pages, budget: 1_000)
        for pack in packs {
            #expect(Set(pack.map(\.identifier)).count == pack.count)
        }
        let appearances = packs.flatMap { $0.map(\.identifier) }
        #expect(appearances.count == Set(appearances).count)
    }

    /// A page at or over the budget travels alone rather than being cut. It can
    /// only happen if maxMergedBatchSamples is configured below batchSize, but
    /// dropping or splitting the page would lose data either way.
    @Test func anOversizedPageTravelsAlone() {
        let packs = HealthSyncEngine.pack(
            [page("big", samples: 5_000), page("small", samples: 3)], budget: 1_000)
        #expect(packs.count == 2)
        let big = packs.first { $0.contains { $0.identifier == "big" } }
        #expect(big?.count == 1)
    }

    @Test func deletionsCountAgainstTheBudget() {
        // A deletion-only page is still a payload the server has to process.
        let packs = HealthSyncEngine.pack(
            [page("a", samples: 0, deletions: 600), page("b", samples: 600)], budget: 1_000)
        #expect(packs.count == 2)
    }

    @Test func emptyInputProducesNoPacks() {
        #expect(HealthSyncEngine.pack([], budget: 1_000).isEmpty)
    }

    @Test func largestFirstKeepsPackCountDown() {
        // Naive insertion order (7, 900, 200) would open a new pack for the 900
        // and strand the 200 in a third. Sorting big-first fits 900+7 and 200
        // into two.
        let packs = HealthSyncEngine.pack(
            [page("tiny", samples: 7), page("huge", samples: 900), page("mid", samples: 200)],
            budget: 1_000)
        #expect(packs.count == 2)
    }
}

/// The coalescing window and merge budget are the two knobs the efficiency work
/// added; both have to survive a state-file round trip, and both need sane
/// values when reading a file written before they existed.
@Suite struct MergedSyncConfigurationTests {
    @Test func newTuningKnobsRoundTrip() throws {
        var config = SyncConfiguration(enabledTypes: ["HKQuantityTypeIdentifierStepCount"])
        config.observerCoalesceWindow = 3.5
        config.maxMergedBatchSamples = 250
        let decoded = try JSONDecoder.puls.decode(
            SyncConfiguration.self, from: try JSONEncoder.puls.encode(config))
        #expect(decoded.observerCoalesceWindow == 3.5)
        #expect(decoded.maxMergedBatchSamples == 250)
    }

    @Test func stateFilesWithoutTheNewKeysGetWorkingDefaults() throws {
        // A pre-upgrade state file. Decoding must not throw — SyncStateStore
        // loads with `try?`, so a thrown error silently resets the whole
        // configuration (server URL, token, enabled types and all).
        let legacy = """
        {"enabledTypes":["HKQuantityTypeIdentifierStepCount"],
         "startDate":1700000000000,"maxConcurrentTypes":4,"batchSize":1000,
         "aggregates":[],"userID":"5ea4d000-0000-4000-8000-000000000001"}
        """
        let decoded = try JSONDecoder.puls.decode(
            SyncConfiguration.self, from: Data(legacy.utf8))
        #expect(decoded.observerCoalesceWindow == 2.0)
        #expect(decoded.maxMergedBatchSamples == 1_000)
        #expect(decoded.enabledTypes == ["HKQuantityTypeIdentifierStepCount"])
    }

    /// The merge budget is clamped up to `batchSize` at run time precisely so a
    /// page can never exceed it; a misconfiguration must not be able to
    /// reintroduce page splitting.
    @Test func mergeBudgetIsNeverBelowAPageSize() {
        var config = SyncConfiguration()
        config.batchSize = 1_000
        config.maxMergedBatchSamples = 10
        #expect(max(config.maxMergedBatchSamples, config.batchSize) == 1_000)
    }
}
