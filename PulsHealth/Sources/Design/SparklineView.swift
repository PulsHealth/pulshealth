import SwiftUI

/// A tiny bar sparkline for a list row: one bar per day over a fixed
/// window, in the row's colour, no axes. It is a shape of activity, not a
/// reading — the accessibility label carries the numbers.
struct SparklineView: View {
    /// Per-day counts, oldest first; zero for days without data.
    let counts: [Int]
    var color: Color = .accentColor

    var body: some View {
        Canvas { context, size in
            guard let peak = counts.max(), peak > 0 else { return }
            let step = size.width / CGFloat(max(counts.count, 1))
            let barWidth = max(step * 0.6, 1)
            for (index, count) in counts.enumerated() where count > 0 {
                let height = max(size.height * CGFloat(count) / CGFloat(peak), 1)
                let rect = CGRect(
                    x: CGFloat(index) * step + (step - barWidth) / 2,
                    y: size.height - height, width: barWidth, height: height)
                context.fill(Path(roundedRect: rect, cornerRadius: barWidth / 2), with: .color(color))
            }
        }
        .frame(width: 56, height: 20)
        .accessibilityLabel(label)
    }

    private var label: String {
        let active = counts.filter { $0 > 0 }.count
        return "\(active) of the last \(counts.count) days with data"
    }
}
