import Charts
import PulsHealthSync
import SwiftUI

/// Derived only from the profile's recorded samples; no extra HealthKit reads.
struct RecordingInsights {
    let profile: TypeProfile

    var averageGap: TimeInterval? {
        guard profile.sampleCount > 1, let cadence = profile.cadence,
              cadence.gapCount == profile.sampleCount - 1,
              let first = profile.earliestStart, let last = profile.latestStart, last >= first else { return nil }
        return last.timeIntervalSince(first) / Double(cadence.gapCount)
    }

    var busiestDays: [TypeProfile.DailyCount] {
        profile.dailyCounts.sorted { $0.count == $1.count ? $0.day < $1.day : $0.count > $1.count }
    }

    var recordsPerRecordedDay: Double? {
        guard !profile.dailyCounts.isEmpty else { return nil }
        return Double(profile.dailyCounts.reduce(0) { $0 + $1.count }) / Double(profile.dailyCounts.count)
    }

    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: profile.timeZoneID) ?? .current
        return calendar
    }

    func dateLabel(_ date: Date) -> String {
        var style = Date.FormatStyle(date: .abbreviated, time: .omitted)
        style.timeZone = calendar.timeZone
        return date.formatted(style)
    }

    struct Weekday: Identifiable {
        let id: Int
        let label: String
        let records: Int
        let recordedDays: Int
        var average: Double? { recordedDays > 0 ? Double(records) / Double(recordedDays) : nil }
    }

    var weekdays: [Weekday] {
        let groups = Dictionary(grouping: profile.dailyCounts) { calendar.component(.weekday, from: $0.day) }
        return [2, 3, 4, 5, 6, 7, 1].map { day in
            let entries = groups[day] ?? []
            return Weekday(id: day, label: calendar.shortWeekdaySymbols[day - 1],
                           records: entries.reduce(0) { $0 + $1.count }, recordedDays: entries.count)
        }
    }
}

struct RecordingSummarySection: View {
    let profile: TypeProfile

    var body: some View {
        let insights = RecordingInsights(profile: profile)
        CardSection("At a glance", subtitle: profileScope(profile)?.capitalized) {
            VStack(spacing: 12) {
                LabeledContent("Records", value: profile.sampleCount.formatted())
                LabeledContent("Days recorded", value: profile.dailyCounts.count.formatted())
                if let gap = insights.averageGap {
                    LabeledContent("Average time between records", value: gapString(gap))
                }
                if let day = insights.busiestDays.first {
                    LabeledContent("Most records in a day", value: day.count.formatted())
                    Text(insights.dateLabel(day.day))
                        .font(.footnote).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .font(.subheadline).monospacedDigit()
        }
    }
}

struct RecordingPatternsSection: View {
    let profile: TypeProfile

    var body: some View {
        let insights = RecordingInsights(profile: profile)
        CardSection("Recording volume") {
            VStack(spacing: 12) {
                LabeledContent("Total records", value: profile.sampleCount.formatted())
                if let average = insights.recordsPerRecordedDay {
                    LabeledContent("Average per recorded day", value: formatValue(average))
                }
                if let coverage = profile.coverage {
                    LabeledContent("Days recorded", value: "\(coverage.daysWithSamples) of \(coverage.daysInSpan)")
                    LabeledContent("Coverage of first-to-last day", value: coverage.fraction.formatted(.percent.precision(.fractionLength(0))))
                    LabeledContent("Days without records", value: max(0, coverage.daysInSpan - coverage.daysWithSamples).formatted())
                }
            }.font(.subheadline).monospacedDigit()
        }
        if !profile.dailyCounts.isEmpty {
            CardSection("By weekday", subtitle: "Average records per recorded day") {
                Chart(insights.weekdays) { day in
                    if let average = day.average {
                        BarMark(x: .value("Weekday", day.label), y: .value("Average records", average))
                            .foregroundStyle(Color.accentColor)
                    }
                }
                .chartXScale(domain: insights.weekdays.map(\.label))
                .frame(height: 160)
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                DisclosureGroup("Weekday details") {
                    VStack(spacing: 12) {
                        ForEach(insights.weekdays) { day in
                            LabeledContent(day.label, value: day.average.map { formatValue($0) + " · \(day.recordedDays) days" } ?? "—")
                        }
                    }.padding(.top, 8)
                }.font(.subheadline)
            }
            CardSection("Busiest days", subtitle: "Most records · top 5") {
                VStack(spacing: 12) {
                    ForEach(Array(insights.busiestDays.prefix(5)), id: \.day) { day in
                        LabeledContent(insights.dateLabel(day.day), value: day.count.formatted())
                    }
                }.font(.subheadline).monospacedDigit()
            }
        }
    }
}
