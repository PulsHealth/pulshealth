import SwiftUI

/// Option C uses the same navigation and native controls, with a compact
/// graphite workspace in dark appearance and a cool, high-contrast light pair.
enum StudioPalette {
    static let canvas = Color("StudioCanvas")
    static let surface = Color("StudioSurface")
    static let code = Color("StudioCode")
    static let line = Color("StudioLine")
    static let onAccent = Color("StudioOnAccent")
}

extension View {
    func studioScreen() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(StudioPalette.canvas)
            .listSectionSpacing(14)
            .listRowSeparatorTint(StudioPalette.line)
            .toolbarBackground(StudioPalette.canvas, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
    }

    func studioSurface() -> some View {
        self.listRowBackground(StudioPalette.surface)
    }
}

struct StudioPlanButton: View {
    var context: ProContext = .plan
    @Environment(AppModel.self) private var model

    var body: some View {
        Button { model.showPro(context) } label: {
            HStack(spacing: 5) {
                Image(systemName: model.subscriptions.hasPro ? "checkmark.seal" : "square.stack.3d.up")
                Text(model.subscriptions.hasPro ? "Pro" : "Free")
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 9)
            .frame(minHeight: 34)
            .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
        }
        .accessibilityLabel(model.subscriptions.hasPro ? "Your Pro plan" : "Free plan. Compare Pro")
        .accessibilityIdentifier("studio.plan")
    }
}

/// Concrete configuration only: never estimates records, bytes or readable
/// history from the number of selected types.
struct StudioMetric: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.title3.weight(.semibold).monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct StudioLead: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

/// Keep summary columns readable instead of compressing them at accessibility sizes.
struct StudioMetrics<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var textSize
    @ViewBuilder let content: () -> Content

    var body: some View {
        let layout = textSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 20))
        layout { content() }
    }
}
