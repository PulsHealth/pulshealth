import SwiftUI
import PulsHealthSync

/// First-run flow: welcome, export, sync, then required Health access.
/// Context comes before iOS asks about the starter set. The final Health
/// page has one neutral Continue button and cannot be skipped on first run.
/// Nothing reaches the engine until that permission step has been answered.
///
/// A `puls://` pairing link can still arrive while this flow is up. It is
/// confirmed here (the prompt cannot come from the covered RootView), and the
/// accepted payload then waits in `AppModel.confirmedPairing` until the flow
/// ends: `pairingAwaitsSyncTab` turns true, RootView opens Sync → Database,
/// and that screen fills its fields from it.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var sizeClass

    enum Page: Int, CaseIterable, Hashable {
        case welcome, export, sync, health
    }

    /// The page on screen. Optional because that is what
    /// `scrollPosition(id:)` binds; nothing here sets it to nil.
    @State private var page: Page? = .welcome
    /// Whether iOS has already asked about the current starter selection.
    @State private var healthSettled = false
    @State private var requestingHealthAccess = false
    @State private var finishing = false

    private var pages: [Page] { Self.pages(healthSettled: healthSettled) }

    /// Health is always last, so there is no later page that can bypass it.
    static func pages(healthSettled: Bool) -> [Page] {
        Page.allCases
    }

    /// A readable line length on iPad, where the screen is far wider than
    /// the text wants to be.
    private let maxContentWidth: CGFloat = 560

    var body: some View {
        // A NavigationStack only for the replay's Close button; nothing is
        // pushed, and on a first run the bar is hidden.
        NavigationStack {
            VStack(spacing: 0) {
                pager
                // The Health permission step is the fourth and final page.
                pageDots
            }
            .background(Color(.systemBackground))
            .toolbar {
                if model.onboardingIsRerun {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { model.completeOnboarding() }
                    }
                }
            }
            .toolbar(model.onboardingIsRerun ? .visible : .hidden, for: .navigationBar)
        }
        .interactiveDismissDisabled()
        // This flow covers RootView, so the prompt for an incoming `puls://`
        // link has to come from here. Not over the iOS Health sheet, and not
        // during the final Apply.
        .pairingLinkPrompt(canPresent: !requestingHealthAccess && !finishing)
        .task {
            // Waits for the stored configuration and the preselected starter
            // set, so "nothing to ask" is never the answer for an empty draft.
            if await !model.onboardingHealthAccessPending() {
                healthSettled = true
            }
        }
    }

    /// A horizontal paging scroll view rather than a paged TabView: a
    /// TabView's pager keeps every drag to itself, so a swipe past its last
    /// page could not be noticed, and on page 2 that swipe is what asks.
    private var pager: some View {
        ScrollViewReader { reader in
            ScrollView(.horizontal) {
                // Not lazy: with a LazyHStack, iOS 27 stopped the first swipe
                // back after the move to page 3 about half a page short.
                HStack(spacing: 0) {
                    ForEach(pages, id: \.self) { each in
                        pageView(each)
                            .containerRelativeFrame(.horizontal)
                            .id(each)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $page)
            .scrollIndicators(.hidden)
            // No swiping while iOS's sheet is on its way or the final apply runs.
            .scrollDisabled(requestingHealthAccess || finishing)
            // Pulling beyond the final Health page also presents the sheet.
            .onPullPastEnd(enabled: !healthSettled && page == .health) { continueFromHealth() }
            // Rotating an iPad, or resizing its window, changes the page
            // width, and the scroll view kept its old offset: on page 3 that
            // left half of page 2 on screen. Put the current page back.
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { _ in
                guard let current = page else { return }
                Task { @MainActor in reader.scrollTo(current, anchor: .leading) }
            }
        }
    }

    @ViewBuilder private func pageView(_ page: Page) -> some View {
        switch page {
        case .welcome: welcomePage
        case .health: healthPage
        case .export: exportPage
        case .sync: syncPage
        }
    }

    // MARK: - Pages

    private var welcomePage: some View {
        pageLayout {
            VStack(spacing: 28) {
                // The app's own mark (Assets.xcassets/Logo, the SVG the site
                // uses, rendered as a template so it takes the tint).
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: logoSize, height: logoSize)
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                pageTitle("Unlock your Health Data", font: .largeTitle.bold())
                VStack(alignment: .leading, spacing: 18) {
                    feature(
                        "heart.text.square", "Explore",
                        "See what Apple Health holds, how much, and where it came from.")
                    feature(
                        "square.and.arrow.up", "Export",
                        "Save any of it to CSV, JSON or JSONL files.")
                    feature(
                        "arrow.triangle.2.circlepath", "Sync",
                        "Keep a live, always up-to-date copy in a database.")
                }
            }
        }
    }

    private var healthPage: some View {
        pageLayout {
            VStack(spacing: 20) {
                pageIcon("heart.text.square", color: .pink)
                pageTitle("Which Health data would you like to use?")
                bodyText("iOS asks which data PulsHealth may read. Pick what you like. You can always add more later in the app.")
                if let hint = model.authorizationHint {
                    Label(hint, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if healthSettled {
                    // Deliberately not "access granted": HealthKit never tells
                    // an app whether a read request was granted, only that
                    // iOS has asked.
                    Label("iOS has already asked about this data.", systemImage: "checkmark.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } footer: {
            // App Review 5.1.1(iv): the one button on a pre-permission screen
            // is a neutral Continue, and it leads to the sheet.
            primaryButton("Continue", busy: requestingHealthAccess || finishing) { continueFromHealth() }
        }
    }

    private var exportPage: some View {
        pageLayout {
            VStack(spacing: 24) {
                pageIcon("square.and.arrow.up", color: .accentColor)
                pageTitle("Export your data")
                bodyText("Export every Health data type from the latest 30 days, as often as you like. CSV, JSON and JSONL are all included with Free.")
                VStack(alignment: .leading, spacing: 18) {
                    feature(
                        "list.bullet.rectangle", "Raw samples",
                        "Every reading, as it was recorded.")
                    feature(
                        "chart.bar.xaxis", "Aggregates",
                        "Hourly or daily summaries, like steps per day.")
                }
                bodyText("Need older history? Pro removes the app’s history limit. No account or database is required for file exports.")
                    .font(.footnote)
            }
        }
    }

    private var syncPage: some View {
        pageLayout {
            VStack(spacing: 20) {
                pageIcon("arrow.triangle.2.circlepath", color: .accentColor)
                pageTitle("Always in sync")
                // Words only: signing in to the PulsHealth database happens on
                // Sync → Database, never in this flow.
                bodyText("Keep a live copy of your Health data in a database, with a PulsHealth account or one you run yourself.")
                VStack(alignment: .leading, spacing: 18) {
                    feature(
                        "bolt.heart", "Automatic",
                        "New data syncs by itself in the background.")
                    feature(
                        "sparkles", "Use it your way",
                        "Ask your AI assistant about it, or browse it on the web.")
                }
                bodyText("Optional. Free sync includes 5 distinct health data types from the latest 30 days. Pro includes unlimited types and all permitted history. Set it up any time from the Sync tab.")
                    .font(.footnote)
                // Opens in Safari, outside the app.
                Link(destination: URL(string: "https://pulshealth.com/#ways")!) {
                    Label("Learn more", systemImage: "arrow.up.right.square")
                }
                if model.confirmedPairing != nil {
                    // Accepted during the flow; Sync → Database opens with it
                    // filled in once the flow is done (RootView, on
                    // `pairingAwaitsSyncTab`).
                    Label("A pairing link is waiting. The Sync tab opens with it filled in when you finish.", systemImage: "qrcode")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: - Building blocks

    private var logoSize: CGFloat { sizeClass == .regular ? 128 : 104 }

    /// Content centred in the page, scrolling when it does not fit (large
    /// text sizes, iPad landscape), with the page's button, if it has one,
    /// pinned below it.
    private func pageLayout<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        pageLayout(content: content) { EmptyView() }
    }

    private func pageLayout<Content: View, Footer: View>(
        @ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer
    ) -> some View {
        let pageContent = content()
        return VStack(spacing: 0) {
            GeometryReader { proxy in
                ScrollView {
                    pageContent
                        .frame(maxWidth: maxContentWidth)
                        .padding(24)
                        .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            footer()
                .frame(maxWidth: maxContentWidth)
                .padding(.horizontal, 24)
        }
    }

    // Multi-line text says so (`fixedSize`): without it a title that needs
    // two lines was cut to one with an ellipsis.

    private func pageTitle(_ text: String, font: Font = .title.bold()) -> some View {
        Text(text)
            .font(font)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    private func bodyText(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func pageIcon(_ symbol: String, color: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 56))
            .foregroundStyle(color)
            .accessibilityHidden(true)
    }

    private func feature(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(.tint)
                .frame(width: 34)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private func primaryButton(_ title: String, busy: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                // The title keeps the button's size while the spinner shows.
                Text(title).opacity(busy ? 0 : 1)
                if busy { ProgressView() }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(requestingHealthAccess || finishing)
        .accessibilityLabel(title)
    }

    private var pageDots: some View {
        let current = page ?? .welcome
        return HStack(spacing: 6) {
            ForEach(Page.allCases, id: \.self) { each in
                Capsule()
                    .fill(each == current ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary))
                    .frame(width: each == current ? 22 : 7, height: 7)
            }
        }
        .animation(.snappy, value: current)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel("Page \(current.rawValue + 1) of \(Page.allCases.count)")
    }

    // MARK: - Actions

    /// Continue from the final page. An answer (including Don't Allow)
    /// precedes Apply and closing the first-run cover.
    private func continueFromHealth() {
        guard !requestingHealthAccess, !finishing else { return }
        guard !healthSettled else {
            finish()
            return
        }
        requestingHealthAccess = true
        Task {
            await model.requestOnboardingHealthAccess()
            requestingHealthAccess = false
            healthSettled = true
            finish()
        }
    }

    private func finish() {
        guard !finishing else { return }
        finishing = true
        Task {
            await model.finishOnboarding()
            finishing = false
        }
    }
}

// MARK: - Pull past the last page

private extension View {
    /// Calls `action` when the person drags a horizontal scroll view past
    /// its trailing end and lets go — a swipe forward on its last page.
    /// Needs iOS 18's scroll geometry and phases; on iOS 17 the pull only
    /// bounces, and the page's own button is the way on.
    @ViewBuilder func onPullPastEnd(enabled: Bool, perform action: @escaping () -> Void) -> some View {
        if #available(iOS 18.0, *) {
            modifier(PullPastEndModifier(enabled: enabled, action: action))
        } else {
            self
        }
    }
}

@available(iOS 18.0, *)
private struct PullPastEndModifier: ViewModifier {
    let enabled: Bool
    let action: () -> Void
    /// Set while a drag has stretched far enough past the end to count.
    @State private var pulled = false

    /// How far past the end, in points, a drag has to stretch: more than a
    /// nudge, less than a deliberate swipe.
    private static let threshold: CGFloat = 40

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                geometry.visibleRect.maxX - geometry.contentSize.width
            } action: { _, beyondEnd in
                if beyondEnd > Self.threshold { pulled = true }
            }
            .onScrollPhaseChange { old, new in
                // The finger lifted: a pull that went far enough asks.
                guard old == .interacting, new != .interacting else { return }
                if pulled, enabled { action() }
                pulled = false
            }
    }
}
