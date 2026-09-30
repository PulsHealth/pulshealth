import Charts
import PulsHealthSync
import SwiftUI

// The Explore tab's charts. One series each, in the type's category colour;
// grey for reference bands; readouts through `ChartCard`, never on the plot.

/// A number in a type's unit, with as many decimals as its size warrants.
func formatValue(_ value: Double) -> String {
    let magnitude = abs(value)
    if magnitude >= 1_000 { return value.formatted(.number.precision(.fractionLength(0))) }
    if magnitude >= 10 { return value.formatted(.number.precision(.fractionLength(0...1))) }
    return value.formatted(.number.precision(.fractionLength(0...2)))
}

// MARK: - Value distribution

/// Fixed-width bins as columns; the knowledge base's typical range as a
/// grey band behind them, when the article has one that overlaps.
struct HistogramChart: View {
    let histogram: TypeProfile.Histogram
    let unit: String?
    let color: Color
    var typicalRange: ClosedRange<Double>?
    @State private var selection: Double?
    /// Spelled-out selection for the card's readout line.
    @Binding var readout: String?

    private struct Bin: Identifiable {
        let id: Int
        let lower: Double
        let upper: Double
        let count: Int
    }

    private var bins: [Bin] {
        let width = (histogram.upperBound - histogram.lowerBound) / Double(max(histogram.binCount, 1))
        return histogram.counts.enumerated().map { index, count in
            Bin(
                id: index,
                lower: histogram.lowerBound + Double(index) * width,
                upper: histogram.lowerBound + Double(index + 1) * width,
                count: count)
        }
    }

    private var selectedBin: Bin? {
        guard let selection else { return nil }
        return bins.first { selection >= $0.lower && selection < $0.upper }
            ?? (selection == histogram.upperBound ? bins.last : nil)
    }

    private var computedReadout: String? {
        guard let bin = selectedBin else { return nil }
        let unitText = unit.map { " \($0)" } ?? ""
        return "\(formatValue(bin.lower)) to \(formatValue(bin.upper))\(unitText) · \(bin.count.formatted()) samples"
    }

    var body: some View {
        let band = typicalRange.map {
            max($0.lowerBound, histogram.lowerBound)...min($0.upperBound, histogram.upperBound)
        }
        Chart {
            if let band, band.lowerBound < band.upperBound {
                RectangleMark(xStart: .value("From", band.lowerBound), xEnd: .value("To", band.upperBound))
                    .foregroundStyle(.gray.opacity(0.15))
            }
            ForEach(bins) { bin in
                BarMark(
                    xStart: .value("From", bin.lower), xEnd: .value("To", bin.upper),
                    y: .value("Samples", bin.count))
                .foregroundStyle(selectedBin == nil || selectedBin?.id == bin.id ? color : color.opacity(0.4))
            }
        }
        .chartXSelection(value: $selection)
        .onChange(of: selection) { readout = computedReadout }
        .chartXAxisLabel(unit ?? "", alignment: .trailing)
        .chartYAxisLabel("Samples")
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        guard let peak = bins.max(by: { $0.count < $1.count }) else { return "Empty histogram" }
        return "Value histogram, \(bins.count) bins from \(formatValue(histogram.lowerBound)) to "
            + "\(formatValue(histogram.upperBound)) \(unit ?? ""); most samples between "
            + "\(formatValue(peak.lower)) and \(formatValue(peak.upper))"
    }
}

// MARK: - Label counts

/// Horizontal bars, one per label, the count beside each. Height grows with
/// the number of rows so nothing is squeezed.
struct LabelBarsChart: View {
    struct Row: Identifiable {
        var id: String { label }
        let label: String
        let count: Int
        /// Text under the label: a date range, a duration.
        var detail: String?
    }

    let rows: [Row]
    let color: Color

    var body: some View {
        Chart(rows) { row in
            BarMark(x: .value("Count", row.count), y: .value("Label", row.label))
                .foregroundStyle(color)
                .annotation(position: .trailing, alignment: .leading, spacing: 4) {
                    Text(row.count.formatted())
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
        }
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(preset: .extended) { value in
                AxisValueLabel {
                    if let label = value.as(String.self) {
                        VStack(alignment: .trailing, spacing: 0) {
                            Text(label).lineLimit(1)
                            if let detail = rows.first(where: { $0.label == label })?.detail {
                                Text(detail).font(.caption2).foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
            }
        }
        .frame(height: max(180, CGFloat(rows.count) * 34))
        .accessibilityLabel(rows.map { "\($0.label): \($0.count.formatted())" }.joined(separator: ", "))
    }
}

// MARK: - Samples over time

enum TimeWindow: String, CaseIterable, Identifiable {
    case month = "30 d"
    case year = "1 y"
    case all = "All"

    var id: String { rawValue }

    var seconds: TimeInterval? {
        switch self {
        case .month: 30 * 86_400
        case .year: 365 * 86_400
        case .all: nil
        }
    }
}

/// Samples per day as columns, scrollable inside a window. The All window
/// re-buckets to weeks or months past a few hundred days: a bar per day
/// over years is a smear, not a chart.
struct DailyCountsChart: View {
    let dailyCounts: [TypeProfile.DailyCount]
    let window: TimeWindow
    let color: Color
    @State private var selection: Date?
    @State private var scrollPosition = Date()
    @Binding var readout: String?

    private enum Grain {
        case day, week, month

        var component: Calendar.Component {
            switch self {
            case .day: .day
            case .week: .weekOfYear
            case .month: .month
            }
        }

        var unit: Calendar.Component { component }
    }

    private var grain: Grain {
        guard window == .all, let first = dailyCounts.first?.day, let last = dailyCounts.last?.day else {
            return .day
        }
        let days = last.timeIntervalSince(first) / 86_400
        if days > 730 { return .month }
        if days > 200 { return .week }
        return .day
    }

    private var buckets: [TypeProfile.DailyCount] {
        let grain = grain
        guard grain != .day else { return dailyCounts }
        let calendar = Calendar.current
        var sums: [Date: Int] = [:]
        for entry in dailyCounts {
            let key = calendar.dateInterval(of: grain.component, for: entry.day)?.start ?? entry.day
            sums[key, default: 0] += entry.count
        }
        return sums.keys.sorted().map { TypeProfile.DailyCount(day: $0, count: sums[$0] ?? 0) }
    }

    private var selected: TypeProfile.DailyCount? {
        guard let selection else { return nil }
        let calendar = Calendar.current
        return buckets.first { calendar.isDate($0.day, equalTo: selection, toGranularity: grain.component) }
    }

    private var computedReadout: String? {
        guard let selected else { return nil }
        let date: String
        switch grain {
        case .day: date = selected.day.formatted(date: .abbreviated, time: .omitted)
        case .week: date = "Week of " + selected.day.formatted(date: .abbreviated, time: .omitted)
        case .month: date = selected.day.formatted(.dateTime.month(.wide).year())
        }
        return "\(date) · \(selected.count.formatted()) samples"
    }

    var body: some View {
        let buckets = buckets
        let grain = grain
        Chart(buckets, id: \.day) { entry in
            BarMark(
                x: .value("Date", entry.day, unit: grain.unit),
                y: .value("Samples", entry.count))
            .foregroundStyle(
                selected == nil || selected?.day == entry.day ? color : color.opacity(0.4))
        }
        .chartXSelection(value: $selection)
        .onChange(of: selection) { readout = computedReadout }
        .chartYAxisLabel("Samples")
        .modifier(WindowScroll(window: window, position: $scrollPosition))
        .accessibilityLabel(accessibilityText)
        .onAppear {
            // Land on the newest data, not on the epoch.
            if let last = dailyCounts.last?.day, let seconds = window.seconds {
                scrollPosition = last.addingTimeInterval(-seconds + 86_400)
            }
        }
        .onChange(of: window) {
            if let last = dailyCounts.last?.day, let seconds = window.seconds {
                scrollPosition = last.addingTimeInterval(-seconds + 86_400)
            }
        }
    }

    private var accessibilityText: String {
        let total = dailyCounts.reduce(0) { $0 + $1.count }
        return "Samples over time: \(total.formatted()) samples across \(dailyCounts.count.formatted()) days"
    }

    /// Horizontal scrolling only while a window is set; All shows everything.
    private struct WindowScroll: ViewModifier {
        let window: TimeWindow
        @Binding var position: Date

        func body(content: Content) -> some View {
            if let seconds = window.seconds {
                content
                    .chartScrollableAxes(.horizontal)
                    .chartXVisibleDomain(length: seconds)
                    .chartScrollPosition(x: $position)
            } else {
                content
            }
        }
    }
}

// MARK: - Aggregate preview

/// The buckets a configured series would produce: a line for the discrete
/// functions, columns for the cumulative ones (a sum is an amount per
/// bucket; an average is a level).
struct AggregatePreviewChart: View {
    let buckets: [HealthExplorer.AggregateBucket]
    let function: AggregateFunction
    let unit: String?
    let color: Color
    @State private var selection: Date?
    @Binding var readout: String?

    private var isColumn: Bool { function == .sum || function == .duration }

    private var selected: HealthExplorer.AggregateBucket? {
        guard let selection else { return nil }
        return buckets.first { selection >= $0.start && selection < $0.end }
    }

    private var computedReadout: String? {
        guard let selected else { return nil }
        let when = selected.start.formatted(date: .abbreviated, time: .shortened)
        guard let value = selected.value else { return "\(when) · no data" }
        return "\(when) · \(formatValue(value)) \(unit ?? "")"
    }

    var body: some View {
        Chart {
            ForEach(Array(buckets.enumerated()), id: \.offset) { _, bucket in
                if let value = bucket.value {
                    if isColumn {
                        BarMark(
                            xStart: .value("From", bucket.start), xEnd: .value("To", bucket.end),
                            y: .value(function.displayName, value))
                        .foregroundStyle(
                            selected == nil || selected?.start == bucket.start ? color : color.opacity(0.4))
                    } else {
                        LineMark(x: .value("Time", bucket.start), y: .value(function.displayName, value))
                            .foregroundStyle(color)
                            .lineStyle(StrokeStyle(lineWidth: 2))
                    }
                }
            }
            if let selected, let value = selected.value, !isColumn {
                PointMark(x: .value("Time", selected.start), y: .value(function.displayName, value))
                    .foregroundStyle(color)
                    .symbolSize(64)
            }
        }
        .chartXSelection(value: $selection)
        .onChange(of: selection) { readout = computedReadout }
        .chartYAxisLabel(unit ?? "")
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        let values = buckets.compactMap(\.value)
        guard let low = values.min(), let high = values.max() else {
            return "\(function.displayName): no data in this window"
        }
        return "\(function.displayName) over \(buckets.count) buckets, from \(formatValue(low)) to "
            + "\(formatValue(high)) \(unit ?? ""), \(buckets.count - values.count) empty"
    }
}
