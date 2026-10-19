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
            if store.isLoaded && !store.hasPro { freeComparison }
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
        .task {
            await store.refreshEntitlements()
            if store.plan?.isLifetime != true { await store.loadProducts() }
        }
    }

    @ViewBuilder private var upgrade: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text(context.title).font(.title2.bold())
                Text(context.explanation).foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
        }
        .listRowBackground(Color.clear)

        Section {
            benefit("All permitted history", detail: "Export and sync beyond the latest 30 days.", symbol: "clock.arrow.circlepath")
            benefit("Unlimited automatic-sync types", detail: "Keep every selected health data type in sync.", symbol: "arrow.triangle.2.circlepath")
        }

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
                Link("Manage Apple Subscriptions", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
            }
            Button("Redeem Code") { redeemingCode = true }.disabled(store.isBusy)
            Button("Restore Purchases") { Task { await store.restore() } }.disabled(store.isBusy)
            if !store.hasPro { Button("Continue with Free") { dismiss() } }
        }
    }

    private var freeComparison: some View {
        Section("Included with Free") {
            benefit("Explore all your data", detail: "All the history Apple Health permits.", symbol: "heart.text.square")
            benefit("Unlimited recent exports", detail: "Every type from the latest 30 days, as often as you like.", symbol: "square.and.arrow.up")
            benefit("Raw readings and aggregates", detail: "CSV, JSON and JSONL are all included.", symbol: "chart.bar.xaxis")
            benefit("Automatic sync", detail: "Up to 5 distinct types from the latest 30 days. Each type counts once across raw readings and aggregates.", symbol: "arrow.triangle.2.circlepath")
        }
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
