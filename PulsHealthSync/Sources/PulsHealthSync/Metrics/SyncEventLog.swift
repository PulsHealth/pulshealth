import Foundation
import os

public enum PulsLog {
    public static let subsystem = "com.puls.healthsync"
    /// Signpost-enabled logger for Instruments profiling of sync phases.
    public static let signposter = OSSignposter(subsystem: subsystem, category: "sync")
}

/// A single observable sync event, surfaced in the app's live log view.
public struct SyncEvent: Identifiable, Sendable, Codable, Equatable {
    public enum Level: String, Sendable, Codable {
        case debug, info, warn, error
    }

    public let id: UUID
    public let date: Date
    public let level: Level
    /// Type identifier this event concerns, if any.
    public let type: String?
    public let message: String

    public init(level: Level, type: String? = nil, message: String) {
        self.id = UUID()
        self.date = Date()
        self.level = level
        self.type = type
        self.message = message
    }
}

/// In-memory ring buffer of recent sync events, mirrored to os.Logger (visible in
/// Console.app / `log stream`) and persisted across launches for post-hoc debugging.
public actor SyncEventLog {
    public static let capacity = 2_000

    private(set) var events: [SyncEvent] = []
    private let logger = Logger(subsystem: PulsLog.subsystem, category: "events")
    private let fileURL: URL
    private var saveTask: Task<Void, Never>?
    /// Streams for live UI updates.
    private var continuations: [UUID: AsyncStream<SyncEvent>.Continuation] = [:]

    public init(directory: URL? = nil) {
        let dir = directory ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PulsHealthSync", isDirectory: true)
        ProtectedStateFile.prepareDirectory(dir)
        self.fileURL = dir.appendingPathComponent("event-log.json")
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder.puls.decode([SyncEvent].self, from: data) {
            events = decoded
        }
    }

    /// Record an event. The message is scrubbed first (`ErrorScrubber`): this
    /// buffer is persisted and exported through the diagnostics share sheet,
    /// so a bearer token, a URL query or a raw server error page must not
    /// survive in it even when an interpolated error carried one.
    public func log(_ level: SyncEvent.Level, type: String? = nil, _ message: String) {
        let message = ErrorScrubber.scrub(message, limit: ErrorScrubber.eventLimit)
        let event = SyncEvent(level: level, type: type, message: message)
        events.append(event)
        if events.count > Self.capacity {
            events.removeFirst(events.count - Self.capacity)
        }
        let prefix = type.map { "[\($0)] " } ?? ""
        switch level {
        case .debug: logger.debug("\(prefix)\(message)")
        case .info: logger.info("\(prefix)\(message)")
        case .warn: logger.warning("\(prefix)\(message)")
        case .error: logger.error("\(prefix)\(message)")
        }
        for c in continuations.values { c.yield(event) }
        scheduleSave()
    }

    public func recent(limit: Int = 500) -> [SyncEvent] {
        Array(events.suffix(limit))
    }

    public func clear() {
        events = []
        scheduleSave()
    }

    /// The full retained buffer as pretty JSON, for the diagnostics share sheet.
    public func exportJSON() -> Data {
        let encoder = JSONEncoder.puls
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(events)) ?? Data()
    }

    /// Live feed of new events for the app's log view.
    public func stream() -> AsyncStream<SyncEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            continuations[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { await self?.removeContinuation(id) }
            }
        }
    }

    private func removeContinuation(_ id: UUID) {
        continuations[id] = nil
    }

    private func scheduleSave() {
        guard saveTask == nil else { return }
        saveTask = Task {
            try? await Task.sleep(for: .seconds(1))
            saveTask = nil
            if let data = try? JSONEncoder.puls.encode(events) {
                try? ProtectedStateFile.write(data, to: fileURL)
            }
        }
    }
}
