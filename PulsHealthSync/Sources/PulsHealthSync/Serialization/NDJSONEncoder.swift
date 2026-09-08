import Foundation
import Compression

/// Encodes a `SyncBatch` as gzip-compressed NDJSON:
/// line 1 = batch header (without samples/deletions), then one line per sample,
/// then one line per deletion (wrapped as {"deleted": ...}), then one line per
/// route payload (wrapped as {"route": ...}), then one line per workout-series
/// stream ({"series": ...}), then one line per aggregate bucket
/// ({"aggregate": ...}), then one line per daily activity summary
/// ({"activitySummary": ...}), then an optional profile line ({"profile": ...}).
/// NDJSON lets the server stream-parse huge batches without building a giant array,
/// and gzip cuts health-sample JSON ~10x on the wire.
///
/// The header opens with `schemaVersion` (`PulsProtocol.version`) and
/// `clientVersion` (the app's marketing version and build) so a receiver can
/// reject a wire format it does not understand and attribute batches to builds.
enum BatchSerializer {
    struct Header: Codable {
        /// Wire-format version; 0 when decoding a header written before versioning.
        var schemaVersion: Int
        /// "<marketing version> (<build>)" of the producing app, or "unknown".
        var clientVersion: String
        var batchID: UUID
        var deviceID: String
        var type: String
        var reason: SyncReason
        var exportedAt: Date
        var sampleCount: Int
        var deletionCount: Int
        var routeCount: Int
        var aggregateCount: Int
        var seriesCount: Int
        var activitySummaryCount: Int
        var profileCount: Int

        // State/wire compat: headers written before aggregates/series/activity
        // summaries/profile existed lack those counts; treat as 0 (mirrors the
        // server's zero default).
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 0
            clientVersion = try c.decodeIfPresent(String.self, forKey: .clientVersion) ?? "unknown"
            batchID = try c.decode(UUID.self, forKey: .batchID)
            deviceID = try c.decode(String.self, forKey: .deviceID)
            type = try c.decode(String.self, forKey: .type)
            reason = try c.decode(SyncReason.self, forKey: .reason)
            exportedAt = try c.decode(Date.self, forKey: .exportedAt)
            sampleCount = try c.decode(Int.self, forKey: .sampleCount)
            deletionCount = try c.decode(Int.self, forKey: .deletionCount)
            routeCount = try c.decode(Int.self, forKey: .routeCount)
            aggregateCount = try c.decodeIfPresent(Int.self, forKey: .aggregateCount) ?? 0
            seriesCount = try c.decodeIfPresent(Int.self, forKey: .seriesCount) ?? 0
            activitySummaryCount = try c.decodeIfPresent(Int.self, forKey: .activitySummaryCount) ?? 0
            profileCount = try c.decodeIfPresent(Int.self, forKey: .profileCount) ?? 0
        }

        init(
            schemaVersion: Int = PulsProtocol.version, clientVersion: String,
            batchID: UUID, deviceID: String, type: String, reason: SyncReason,
            exportedAt: Date, sampleCount: Int, deletionCount: Int,
            routeCount: Int, aggregateCount: Int, seriesCount: Int,
            activitySummaryCount: Int, profileCount: Int
        ) {
            self.schemaVersion = schemaVersion
            self.clientVersion = clientVersion
            self.batchID = batchID
            self.deviceID = deviceID
            self.type = type
            self.reason = reason
            self.exportedAt = exportedAt
            self.sampleCount = sampleCount
            self.deletionCount = deletionCount
            self.routeCount = routeCount
            self.aggregateCount = aggregateCount
            self.seriesCount = seriesCount
            self.activitySummaryCount = activitySummaryCount
            self.profileCount = profileCount
        }
    }

    private struct DeletionLine: Codable {
        var deleted: SyncDeletion
    }

    private struct RouteLine: Codable {
        var route: RoutePayload
    }

    private struct SeriesLine: Codable {
        var series: WorkoutSeriesPayload
    }

    private struct ProfileLine: Codable {
        var profile: ProfilePayload
    }

    private struct AggregateLine: Codable {
        var aggregate: AggregateSampleRow
    }

    private struct ActivitySummaryLine: Codable {
        var activitySummary: ActivitySummaryRow
    }

    /// `clientVersion` defaults to the host app's version; tests pin it.
    static func ndjson(for batch: SyncBatch, clientVersion: String = PulsProtocol.clientVersion) throws -> Data {
        let encoder = JSONEncoder.puls
        let newline = Data([0x0A])
        var out = Data()
        out.reserveCapacity(batch.samples.count * 220 + 256)

        let header = Header(
            clientVersion: clientVersion,
            batchID: batch.batchID, deviceID: batch.deviceID, type: batch.type,
            reason: batch.reason, exportedAt: batch.exportedAt,
            sampleCount: batch.samples.count, deletionCount: batch.deletions.count,
            routeCount: batch.routes.count, aggregateCount: batch.aggregates.count,
            seriesCount: batch.series.count,
            activitySummaryCount: batch.activitySummaries.count,
            profileCount: batch.profile == nil ? 0 : 1
        )
        out.append(try encoder.encode(header))
        out.append(newline)
        for sample in batch.samples {
            out.append(try encoder.encode(sample))
            out.append(newline)
        }
        for deletion in batch.deletions {
            out.append(try encoder.encode(DeletionLine(deleted: deletion)))
            out.append(newline)
        }
        for route in batch.routes {
            out.append(try encoder.encode(RouteLine(route: route)))
            out.append(newline)
        }
        for series in batch.series {
            out.append(try encoder.encode(SeriesLine(series: series)))
            out.append(newline)
        }
        for aggregate in batch.aggregates {
            out.append(try encoder.encode(AggregateLine(aggregate: aggregate)))
            out.append(newline)
        }
        for summary in batch.activitySummaries {
            out.append(try encoder.encode(ActivitySummaryLine(activitySummary: summary)))
            out.append(newline)
        }
        if let profile = batch.profile {
            out.append(try encoder.encode(ProfileLine(profile: profile)))
            out.append(newline)
        }
        return out
    }

    /// gzip = 10-byte header + raw DEFLATE + CRC32 + length trailer.
    /// Apple's Compression framework provides raw DEFLATE (COMPRESSION_ZLIB);
    /// we add the gzip framing so any standard server middleware can decode it.
    static func gzip(_ data: Data) -> Data {
        let deflated = rawDeflate(data)
        var out = Data(capacity: deflated.count + 18)
        out.append(contentsOf: [0x1F, 0x8B, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xFF])
        out.append(deflated)
        var crc = crc32(data).littleEndian
        withUnsafeBytes(of: &crc) { out.append(contentsOf: $0) }
        var size = UInt32(truncatingIfNeeded: data.count).littleEndian
        withUnsafeBytes(of: &size) { out.append(contentsOf: $0) }
        return out
    }

    private static func rawDeflate(_ data: Data) -> Data {
        data.withUnsafeBytes { (src: UnsafeRawBufferPointer) -> Data in
            guard let srcBase = src.baseAddress, !src.isEmpty else { return Data() }
            let dstCapacity = max(64, data.count + data.count / 2)
            let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: dstCapacity)
            defer { dst.deallocate() }
            let written = compression_encode_buffer(
                dst, dstCapacity,
                srcBase.assumingMemoryBound(to: UInt8.self), data.count,
                nil, COMPRESSION_ZLIB
            )
            guard written > 0 else { return data }
            return Data(bytes: dst, count: written)
        }
    }

    private static let crcTable: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 {
            c = (c & 1) == 1 ? (0xEDB88320 ^ (c >> 1)) : (c >> 1)
        }
        return c
    }

    private static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFFFFFF
        for byte in data {
            crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
        }
        return crc ^ 0xFFFFFFFF
    }
}
