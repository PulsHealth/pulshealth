import SwiftUI
import PulsHealthSync

struct RootView: View {
    private enum Tab: String, Hashable {
        case explore, export, sync, settings

        /// Debug builds accept `-PulsInitialTab <name>` so a scripted
        /// simulator run can screenshot each tab without tapping; release
        /// builds always start on Export.
        static var initial: Tab {
            #if DEBUG
            if let name = UserDefaults.standard.string(forKey: "PulsInitialTab"), let tab = Tab(rawValue: name) {
                return tab
            }
            #endif
            return .explore
        }
    }
    @State private var selection: Tab = Tab.initial
    @State private var exploredType: ExploreRoute?
    @State private var typeActions = TypeActions()
    @State private var connectionsNavigationID = UUID()
    @State private var exportNavigationID = UUID()
    /// Owned here rather than by SyncView so an accepted pairing link can pop
    /// whatever the Sync tab had pushed and land on its Database screen.
    @State private var syncPath: [SyncRoute] = {
        #if DEBUG
        // Open the real setup screens for repeatable simulator captures.
        if let destination = UserDefaults.standard.string(forKey: "PulsInitialServer") {
            let choice: DatabaseDestination? = switch destination {
            case "own": .own
            case "managed": .pulsHealth
            default: nil
            }
            return [.server(scan: false, choice: choice)]
        }
        #endif
        return []
    }()
    init(typeActions: TypeActions = TypeActions()) {
        _typeActions = State(initialValue: typeActions)
    }

    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    @ViewBuilder private var presentedContent: some View {
        @Bindable var model = model
        @Bindable var requests = model.dataRequests
        VStack(spacing: 0) {
            if model.subscriptions.showsGiftWelcome && !model.showsOnboarding {
                VStack(alignment: .leading, spacing: 8) {
                    Text("30 days of Pro, on us").font(.headline)
                    Text("Thanks for being an early PulsHealth user. No subscription required, and no automatic charge.")
                        .font(.subheadline)
                    HStack {
                        Button("View gift") {
                            model.subscriptions.dismissGiftWelcome()
                            model.showPro()
                        }
                        Spacer()
                        Button("Dismiss") { model.subscriptions.dismissGiftWelcome() }
                    }
                    .font(.subheadline.weight(.semibold))
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.regularMaterial)
            }
            tabContent
        }
        .environment(typeActions)
        .sheet(item: Binding(get: { model.showsOnboarding ? nil : model.sharing.invitation }, set: { model.sharing.invitation = $0 })) { invitation in
            NavigationStack { CollectionReviewView(invitation: invitation) }.environment(model)
        }
        .onChange(of: model.sharing.invitation?.id) { _, id in if id != nil { selection = .sync } }
        .onChange(of: typeActions.destination) { _, destination in
            guard let destination else { return }
            switch destination {
            case .export:
                exportNavigationID = UUID()
                selection = .export
            case .sync:
                syncPath = [.personal]
                selection = .sync
            }
            typeActions.destination = nil
        }
        .sheet(isPresented: $model.showsPro) {
            NavigationStack { ProView(context: model.proContext) }.environment(model)
        }
        .sheet(isPresented: $requests.presented, onDismiss: { model.dataRequests.close() }) {
            NavigationStack { FulfillDataRequestView() }.environment(model)
        }
        .onChange(of: model.dataRequests.pending) { _, _ in presentDataRequest() }
        .onChange(of: model.showsOnboarding) { _, _ in presentDataRequest() }
        .alert("Request Could Not Be Opened", isPresented: Binding(
            get: { model.dataRequests.pending == nil && model.dataRequests.error != nil && !model.showsOnboarding },
            set: { if !$0 { model.dataRequests.error = nil } }
        )) { Button("OK") { model.dataRequests.error = nil } } message: {
            Text(model.dataRequests.error ?? "")
        }

    }
    var body: some View {
        @Bindable var model = model
        presentedContent
        .task {
            presentDataRequest()
            if scenePhase == .active {
                await model.start()
                await model.subscriptions.beginForegroundVisit()
                offerSyncReviewOnReturn()
            }
        }
        .onChange(of: selection) { _, _ in
            model.reviews.cancelPending()
            typeActions.notice = nil
        }
        .onChange(of: model.sharing.organizerToOpen) { _, id in
            guard let id else { return }
            syncPath = [.organizer(id)]; selection = .sync
            model.sharing.organizerToOpen = nil
        }
        .onChange(of: model.sharing.returnToConnections) {
            syncPath = []; connectionsNavigationID = UUID(); selection = .sync
        }
        .onChange(of: model.initialSyncReviewRequested) {
            syncPath = [.personal]; selection = .sync
        }
        .onChange(of: syncPath) { _, _ in model.reviews.cancelPending() }
        .onChange(of: model.wakeRecords) { _, _ in offerSyncReviewOnReturn() }
        .onChange(of: model.reviews.syncReturnReady) { _, ready in
            if ready { offerSyncReviewOnReturn() }
        }
        .onChange(of: model.reviewRequestsBlocked) { _, blocked in
            if blocked { model.reviews.cancelPending() }
            else { offerSyncReviewOnReturn() }
        }
        // Sync users can return to any tab after days of background uploads.
        .reviewRequestOpportunity(.sync, blocked: model.appliedConfig.serverURL == nil || model.syncPausedByPlan)
        // An incoming `puls://` link asks before it fills anything. While the
        // first-run flow covers this view the prompt is OnboardingView's; and
        // it waits its turn behind the server-change prompt, which can be up
        // from launch.
        .pairingLinkPrompt(canPresent: !model.showsOnboarding && model.pendingServerChange == nil)
        // Accepted: take the user to the fields the link filled in, the same
        // place a scan from the Database screen would have left them.
        // ServerSettingsView collects the payload itself; nothing is applied
        // from here.
        .onChange(of: model.pairingAwaitsSyncTab) { _, waiting in
            guard waiting else { return }
            syncPath = [.server(scan: false)]
            selection = .sync
        }
        // Save & Apply on Settings, the User page, the Database screen or the
        // Sync tab's Apply bar can all raise the server/user-change prompt; show it
        // above every tab.
        .serverChangePrompt()
        // First run only: a fresh install lands here with no server and no
        // types, so the tabs have nothing to show and nothing to say about
        // where to start. `showsOnboarding` is false for every configured
        // install (see AppModel).
        .fullScreenCover(isPresented: $model.showsOnboarding) {
            OnboardingView().environment(model)
        }
    }
    private var tabContent: some View {
            TabView(selection: $selection) {
                NavigationSplitView {
                    ExploreView(selection: $exploredType)
                        .reviewRequestOpportunity(.explore, blocked: exploredType != nil)
                        .navigationSplitViewColumnWidth(min: 280, ideal: 340, max: 400)
                } detail: {
                    NavigationStack {
                        if case .type(let id) = exploredType {
                            TypePageView(identifier: id)
                        } else {
                            ContentUnavailableView(
                                "Choose a Health Type", systemImage: "heart.text.square",
                                description: Text("Select a type to explore its readings and trends."))
                        }
                    }
                    // A different type starts at its own detail root; resizing
                    // keeps this identity and any pushed analysis unchanged.
                    .id(exploredType)
                }
                .navigationSplitViewStyle(.balanced)
                    .safeAreaInset(edge: .bottom) { TypeActionNoticeView() }
                    .tabItem { Label("Explore", systemImage: "heart.fill") }
                    .tag(Tab.explore)
                NavigationStack { ExportView() }
                    .id(exportNavigationID)
                    .tabItem { Label("Export", systemImage: "square.and.arrow.up") }
                    .badge(model.export.draft.selectedTypeCount)
                    .tag(Tab.export)
                NavigationStack(path: $syncPath) {
                    ConnectionsView(path: $syncPath)
                        .navigationDestination(for: SyncRoute.self) { route in ConnectionRouteView(route: route, path: $syncPath) }
                }
                    .id(connectionsNavigationID)
                    // The Raw Samples and Aggregates pickers are pushed on this
                    // stack, so their Apply/Discard bar belongs to the tab, not
                    // to a screen that could be popped with edits still staged.
                    .safeAreaInset(edge: .bottom) { PendingChangesBar() }
                    .tabItem { Label("Connections", systemImage: "arrow.triangle.2.circlepath") }
                    .badge(model.hasPendingChanges ? "•" : nil)
                    .tag(Tab.sync)
                NavigationStack { SettingsView() }
                    .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                    .tag(Tab.settings)
            }
    }
    private func offerSyncReviewOnReturn() {
        guard scenePhase == .active, !model.reviewRequestsBlocked,
              model.appliedConfig.serverURL != nil, !model.syncPausedByPlan else { return }
        model.reviews.offerSyncOnReturn()
    }

    private func presentDataRequest() {
        if !model.showsOnboarding, model.dataRequests.pending != nil {
            model.reviews.cancelPending()
            model.dataRequests.presented = true
        }
    }
}
