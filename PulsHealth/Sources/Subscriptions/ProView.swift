import SwiftUI
import StoreKit

struct ProView: View {
    var context: ProContext = .plan
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var selectedID = SubscriptionStore.annualID
    @State private var redeemingCode = false
    @State private var managingSubscriptions = false

    private var store: SubscriptionStore { model.subscriptions }
    private var selectedProduct: Product? {
        choices.first { $0.id == selectedID }
            ?? choices.first { $0.id == SubscriptionStore.annualID }
            ?? choices.first
    }
    private var choices: [Product] {
        let ids = store.hasPro && store.complimentaryExpiresAt == nil
            ? [SubscriptionStore.lifetimeID]
            : [SubscriptionStore.annualID, SubscriptionStore.monthlyID, SubscriptionStore.lifetimeID]
        return ids.compactMap { id in store.products.first { $0.id == id } }
    }

    var body: some View {
        List {
            if !store.isLoaded {
                Section { ProgressView("Checking your plan") }
            } else if store.hasPro {
                activePlan
                if store.plan?.isLifetime != true { purchaseOptions }
            } else {
                upgrade
            }
            if let message = store.message {
                Section { Text(message).accessibilityIdentifier("pro.purchaseMessage") }
            }
            accountActions
            Section {
                Link("Privacy Policy", destination: URL(string: "https://pulshealth.com/privacy/")!)
                Link("Terms of Use", destination: URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
            } footer: {
                Text("Pro includes all current and future PulsHealth app features. PulsHealth server, hosting and other services are separate. Apple Health permissions determine what data you can read.")
            }
        }
        .navigationTitle(store.hasPro ? "Your plan" : "PulsHealth Pro")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        .offerCodeRedemption(isPresented: $redeemingCode) { _ in
            // Completion is not proof of access: only verified StoreKit data
            // and the transaction listener can grant Pro.
            Task { await store.refreshEntitlements() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await store.refreshEntitlements() } }
        }
        .task(id: store.isLoaded && store.plan?.isLifetime != true) {
            if store.isLoaded && store.plan?.isLifetime != true {
                await store.loadProducts()
            }
        }
        .task {
            await store.refreshEntitlements()
        }
    }

    @ViewBuilder private var upgrade: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text(context.title).font(.largeTitle.bold())
                Text(context.explanation).foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
        }
        .listRowBackground(Color.clear)

        planComparison

        purchaseOptions
    }

    @ViewBuilder private var purchaseOptions: some View {
        Section {
            ForEach(choices) { product in
                Button { selectedID = product.id } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Image(systemName: selectedProduct?.id == product.id ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selectedProduct?.id == product.id ? Color.accentColor : .secondary)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(planName(product)).font(.headline)
                            Text(isLifetime(product) ? "Pay once, yours for life" : (isAnnual(product) ? "Billed once a year" : "Billed each month"))
                                .font(.caption).foregroundStyle(.secondary)
                            if dynamicTypeSize.isAccessibilitySize {
                                Text(product.displayPrice).font(.headline)
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        if !dynamicTypeSize.isAccessibilitySize {
                            Text(product.displayPrice).font(.headline)
                                .foregroundStyle(.primary)
                        }
                    }
                    .foregroundStyle(.primary)
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
                .disabled(store.isBusy)
                .accessibilityAddTraits(selectedProduct?.id == product.id ? [.isSelected] : [])
                .accessibilityIdentifier(isLifetime(product) ? "pro.lifetime" : (isAnnual(product) ? "pro.annual" : "pro.monthly"))
            }
            if store.isBusy { ProgressView("Contacting the App Store") }
            if choices.isEmpty && !store.isBusy {
                Text("Pro purchases are currently unavailable. You can keep using Free.")
                    .foregroundStyle(.secondary)
                Button("Try again") { Task { await store.loadProducts() } }
            }
        } header: {
            Text("Choose billing")
        } footer: {
            Text("Every option includes all current and future app features. Server, hosting and other services are separate.")
            if store.complimentaryExpiresAt != nil {
                Text("Optional. Your gift continues without a purchase. Buying starts paid access immediately; the gift does not delay subscription billing.")
            }
        }

        if let selected = selectedProduct {
            Section {
                Button {
                    Task { await store.purchase(selected) }
                } label: {
                    Text(isLifetime(selected) ? "Buy Lifetime for \(selected.displayPrice)" : "Subscribe for \(selected.displayPrice) per \(isAnnual(selected) ? "year" : "month")")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(store.isBusy)
                .accessibilityIdentifier(isLifetime(selected) ? "pro.buyLifetime" : "pro.subscribe")
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            } footer: {
                if isLifetime(selected) {
                    Text("Charged once to your Apple Account. No renewal. Lifetime unlocks all current and future PulsHealth app features; PulsHealth server, hosting and other services are excluded.")
                    if store.hasPro && store.complimentaryExpiresAt == nil {
                        Text("Buying Lifetime does not cancel an existing subscription. Manage it in your Apple Account to stop renewal.")
                    }
                } else {
                    Text("Charged to your Apple Account. Renews at \(selected.displayPrice) per \(isAnnual(selected) ? "year" : "month") unless canceled at least 24 hours before the period ends. Manage or cancel in the App Store.")
                }
            }
        }
    }

    @ViewBuilder private var activePlan: some View {
        Section {
            Label("PulsHealth Pro", systemImage: "checkmark.seal.fill")
                .font(.title2.bold())
                .foregroundStyle(Color.accentColor)
            Text(store.complimentaryExpiresAt != nil ? "Complimentary Pro" : (store.plan?.status ?? "Pro is active"))
            if let end = store.complimentaryExpiresAt {
                Text("Thanks for being an early PulsHealth user. Enjoy 30 days of Pro on us—no subscription required.")
                LabeledContent("Access ends", value: end.formatted(date: .abbreviated, time: .omitted))
                Text("Your gift ends automatically and returns to Free. There is no automatic charge.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let plan = store.plan {
                LabeledContent("Plan", value: plan.name)
                if let date = plan.date {
                    LabeledContent(plan.dateLabel, value: date.formatted(date: .abbreviated, time: .omitted))
                }
                Text(plan.explanation).font(.footnote).foregroundStyle(.secondary)
            } else if store.complimentaryExpiresAt == nil {
                Text("Pro access is verified. Check your Apple Account for renewal details.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        Section("Ready to use") {
            benefit("All permitted history", detail: "Export and sync older data.", symbol: "clock.arrow.circlepath")
            benefit("Unlimited automatic-sync types", detail: "Your full selection is available.", symbol: "arrow.triangle.2.circlepath")
        }
        if let title = context.returnTitle {
            Section {
                Button(title) { dismiss() }
                Text("Your selection is kept. Review it before exporting, sending or applying sync settings.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private var accountActions: some View {
        Section {
            if store.hasPro && store.complimentaryExpiresAt == nil {
                if ProcessInfo.processInfo.isiOSAppOnMac {
                    Link("Manage Apple Subscriptions", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                } else {
                    Button("Manage Apple Subscriptions") { managingSubscriptions = true }
                        .manageSubscriptionsSheet(isPresented: $managingSubscriptions)
                        .onChange(of: managingSubscriptions) { _, presented in
                            if !presented { Task { await store.refreshEntitlements() } }
                        }
                }
            }
            Button("Redeem Code") { redeemingCode = true }.disabled(store.isBusy)
            Button("Restore Purchases") { Task { await store.restore() } }.disabled(store.isBusy)
            if !store.hasPro { Button("Continue with Free") { dismiss() } }
        }
    }

    private var planComparison: some View {
        Section {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(spacing: 12) { comparisonCards }
                } else {
                    HStack(alignment: .top, spacing: 12) { comparisonCards }
                }
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        } footer: {
            Text("Unlimited means all history Apple Health permits. Both plans include all formats and unlimited file exports.")
        }
    }

    @ViewBuilder private var comparisonCards: some View {
        comparisonCard("Free", history: "30 days", types: "Up to 5", highlighted: false)
        comparisonCard("Pro", history: "Unlimited", types: "Unlimited", highlighted: true)
    }

    private func comparisonCard(_ title: String, history: String, types: String, highlighted: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title)
                .font(.headline)
                .foregroundStyle(highlighted ? Color.accentColor : .secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text(history).font(.title2.bold())
                Text("Export & sync history")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                Text(types).font(.headline)
                Text("Sync data types")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            highlighted ? Color.accentColor.opacity(0.08) : Color(.secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }

    private func isLifetime(_ product: Product) -> Bool { product.id == SubscriptionStore.lifetimeID }
    private func planName(_ product: Product) -> String {
        isLifetime(product) ? "Lifetime" : (isAnnual(product) ? "Yearly" : "Monthly")
    }
    private func isAnnual(_ product: Product) -> Bool { product.id == SubscriptionStore.annualID }

    private func benefit(_ title: String, detail: String, symbol: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.vertical, 2)
        } icon: {
            Image(systemName: symbol).foregroundStyle(Color.accentColor)
        }
        .accessibilityElement(children: .combine)
    }
}
