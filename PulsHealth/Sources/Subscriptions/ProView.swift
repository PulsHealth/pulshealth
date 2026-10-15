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
        store.products.first { $0.id == selectedID }
            ?? store.products.first { $0.id == SubscriptionStore.annualID }
            ?? store.products.first
    }
    private var choices: [Product] {
        [SubscriptionStore.annualID, SubscriptionStore.monthlyID]
            .compactMap { id in store.products.first { $0.id == id } }
    }

    var body: some View {
        List {
            if !store.isLoaded {
                Section { ProgressView("Checking your plan") }
            } else if store.hasPro {
                activePlan.studioSurface()
            } else {
                upgrade.studioSurface()
            }
            if let message = store.message {
                Section { Text(message).accessibilityIdentifier("pro.purchaseMessage") }
            }
            accountActions.studioSurface()
            if store.isLoaded && !store.hasPro { freeComparison.studioSurface() }
            Section {
                Link("Privacy Policy", destination: URL(string: "https://pulshealth.com/privacy/")!)
                Link("Terms of Use", destination: URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
            } footer: {
                Text("Pro unlocks app features. Database hosting is separate, and Apple Health permissions still determine what data you can read.")
            }
        }
        .studioScreen()
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
            if !store.hasPro { await store.loadProducts() }
        }
    }

    @ViewBuilder private var upgrade: some View {
        Section {
            StudioLead(symbol: "square.stack.3d.up",
                       title: context == .plan ? "Give your data more room." : context.title,
                       detail: context.explanation)
        }
        .listRowBackground(Color.clear)

        Section("Workspace access") {
            comparisonRow("Export history", free: "30 days", pro: "All permitted")
            comparisonRow("Automatic-sync types", free: "5 types", pro: "Unlimited")
        }

        Section {
            ForEach(choices) { product in
                Button { selectedID = product.id } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Image(systemName: selectedProduct?.id == product.id ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selectedProduct?.id == product.id ? Color.accentColor : .secondary)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(isAnnual(product) ? "Yearly" : "Monthly").font(.headline)
                            Text(isAnnual(product) ? "Billed once a year" : "Billed each month")
                                .font(.caption).foregroundStyle(.secondary)
                            if dynamicTypeSize.isAccessibilitySize {
                                Text(product.displayPrice).font(.title3.weight(.semibold).monospacedDigit())
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        if !dynamicTypeSize.isAccessibilitySize {
                            Text(product.displayPrice).font(.title3.weight(.semibold).monospacedDigit())
                                .foregroundStyle(.primary)
                        }
                    }
                    .foregroundStyle(.primary)
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
                .listRowBackground(selectedProduct?.id == product.id
                    ? Color.accentColor.opacity(0.12) : StudioPalette.surface)
                .disabled(store.isBusy)
                .accessibilityAddTraits(selectedProduct?.id == product.id ? [.isSelected] : [])
                .accessibilityIdentifier(isAnnual(product) ? "pro.annual" : "pro.monthly")
            }
            if store.isBusy { ProgressView("Contacting the App Store") }
            if choices.isEmpty && !store.isBusy {
                Text("Subscriptions are currently unavailable. You can keep using Free.")
                    .foregroundStyle(.secondary)
                Button("Try again") { Task { await store.loadProducts() } }
            }
        } header: {
            Text("Choose billing")
        } footer: {
            Text("Both options include the same Pro features.")
        }

        if let selected = selectedProduct {
            Section {
                Button {
                    Task { await store.purchase(selected) }
                } label: {
                    Text("Subscribe for \(selected.displayPrice) per \(isAnnual(selected) ? "year" : "month")")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .foregroundStyle(StudioPalette.onAccent)
                .controlSize(.large)
                .disabled(store.isBusy)
                .accessibilityIdentifier("pro.subscribe")
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            } footer: {
                Text("Charged to your Apple Account. Renews at \(selected.displayPrice) per \(isAnnual(selected) ? "year" : "month") unless canceled at least 24 hours before the period ends. Manage or cancel in the App Store.")
            }
        }
    }

    @ViewBuilder private var activePlan: some View {
        Section {
            Label("PulsHealth Pro", systemImage: "checkmark.seal.fill")
                .font(.title2.bold())
                .foregroundStyle(Color.accentColor)
            Text(store.plan?.status ?? "Pro is active")
            if let plan = store.plan {
                LabeledContent("Plan", value: plan.productID == SubscriptionStore.annualID ? "Yearly" : "Monthly")
                if let date = plan.date {
                    LabeledContent(plan.dateLabel, value: date.formatted(date: .abbreviated, time: .omitted))
                }
                Text(plan.explanation).font(.footnote).foregroundStyle(.secondary)
            } else {
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
            if store.hasPro {
                Link("Manage Subscription", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
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

    private func isAnnual(_ product: Product) -> Bool { product.id == SubscriptionStore.annualID }

    private func comparisonRow(_ title: String, free: String, pro: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.subheadline.weight(.semibold))
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 16) { comparisonValues(free: free, pro: pro) }
                VStack(alignment: .leading, spacing: 5) { comparisonValues(free: free, pro: pro) }
            }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func comparisonValues(free: String, pro: String) -> some View {
        Text("Free: \(free)").foregroundStyle(.secondary)
        Text("Pro: \(pro)").foregroundStyle(Color.accentColor)
    }

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
