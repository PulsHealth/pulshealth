import SwiftUI
import PulsHealthSync

struct ConnectionRemovalView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    let destination: SavedSyncDestination
    var remove: () async -> Bool
    @State private var removing = false
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack { Spacer(); Button("Cancel") { dismiss() }.disabled(removing) }
            Spacer()
            Image(systemName: "externaldrive.badge.minus").font(.system(size: 46, weight: .light)).foregroundStyle(.red)
            Text("Remove connection?").font(.largeTitle.bold())
            Text(model.connectionName(destination)).font(.headline).foregroundStyle(.secondary)
            if model.connectionName(destination) != destination.identity.serverLabel {
                Text(destination.identity.serverLabel).font(.subheadline).foregroundStyle(.secondary)
            }
            LabeledContent("User ID", value: destination.userID).font(.caption).foregroundStyle(.secondary)
            Text("Syncing to this database will stop. Local credentials and sync progress will be removed. Data already on the server stays there.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let error = model.lastErrorMessage { Text(error).foregroundStyle(.red) }
            Spacer()
            Button(role: .destructive) {
                removing = true
                Task { if await remove() { dismiss() }; removing = false }
            } label: {
                HStack { Spacer(); if removing { ProgressView() }; Text(removing ? "Removing…" : "Remove connection"); Spacer() }
            }.buttonStyle(.borderedProminent).tint(.red).controlSize(.large).disabled(removing)
            Button("Keep connection") { dismiss() }.frame(maxWidth: .infinity).disabled(removing)
        }.padding(28).background(Color(uiColor: .systemGroupedBackground)).interactiveDismissDisabled(removing)
    }
}
