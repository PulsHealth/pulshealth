import SwiftUI
import StoreKit

struct ProView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let store = model.subscriptions
        List {
            Section {
                Label("PulsHealth Pro", systemImage: "waveform.path.ecg")
                    .font(.title2.bold())
                Text("Export your history. Keep every measurement in sync.")
                if store.hasPro {
                    Label("Pro is active", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                }
                if let reason = model.proReason { Text(reason).foregroundStyle(.secondary) }
            }
            Section("Included with Pro") {
                Label("All available Apple Health history", systemImage: "clock.arrow.circlepath")
                Label("Unlimited health data types for automatic sync", systemImage: "arrow.triangle.2.circlepath")
                Label("Raw readings and custom aggregates", systemImage: "chart.bar.xaxis")
                Text("CSV, JSON and JSONL. No PulsHealth account required. Hosting is separate. Apple Health permissions still apply.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if !store.hasPro {
                Section {
                    ForEach(store.products) { product in
                        Button {
                            Task { await store.purchase(product) }
                        } label: {
                            HStack {
                                Text(product.id == SubscriptionStore.annualID ? "Yearly" : "Monthly")
                                Spacer()
                                Text("\(product.displayPrice) / \(product.id == SubscriptionStore.annualID ? "year" : "month")")
                                    .bold()
                            }
                        }
                        .disabled(store.isBusy)
                    }
                    if store.isBusy { ProgressView().accessibilityLabel("Contacting the App Store") }
                    if store.products.isEmpty && !store.isBusy {
                        Button("Load subscriptions") { Task { await store.loadProducts() } }
                    }
                } header: {
                    Text("Choose your subscription")
                } footer: {
                    Text("Payment is charged to your Apple Account. Subscriptions renew automatically unless canceled at least 24 hours before the current period ends. Manage or cancel in your App Store subscriptions.")
                }
            }
            if let message = store.message {
                Section { Text(message).accessibilityIdentifier("pro.purchaseMessage") }
            }
            Section {
                Button("Restore Purchases") { Task { await store.restore() } }
                    .disabled(store.isBusy)
                Link("Manage Subscription", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                Link("Privacy Policy", destination: URL(string: "https://pulshealth.com/privacy/")!)
                Link("Terms of Use", destination: URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
            }
            Section("Always free") {
                Text("Explore all your data. Export every health data type from the most recent 30 days, as often as you want, in any format. Automatically sync up to 5 health data types from the most recent 30 days. Each type counts once across raw readings and aggregates.")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("PulsHealth Pro")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        .task { await store.refreshEntitlements(); await store.loadProducts() }
    }
}
