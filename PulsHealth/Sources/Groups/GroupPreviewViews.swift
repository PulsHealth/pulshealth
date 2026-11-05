#if DEBUG
import SwiftUI

struct GroupsPreviewView: View {
    @Environment(AppModel.self) private var app
    @State private var invitation: PreviewGroup?
    @State private var code = ""

    var body: some View {
        List {
            Section {
                Label("UI preview · no health data is sent", systemImage: "flask")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                if app.groupsPreview.memberships.isEmpty {
                    ContentUnavailableView("No groups yet", systemImage: "person.2",
                        description: Text("Open an invitation from your study, gym or program to get started."))
                }
                ForEach(app.groupsPreview.memberships) { membership in
                    NavigationLink { GroupMembershipPreviewView(group: membership.group) } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(membership.group.name).font(.headline)
                            Text(membership.group.organizer).font(.subheadline).foregroundStyle(.secondary)
                            Text(membership.enabled.isEmpty ? "Sharing off" : "\(membership.enabled.count) data types selected")
                                .font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 4)
                    }
                }
            } header: { Text("Your groups") }
            Section {
                ForEach(PreviewGroup.examples) { group in
                    Button { invitation = group } label: {
                        Label(group.name, systemImage: "envelope.open")
                    }
                }
                HStack {
                    TextField("Invitation code", text: $code).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Open") {
                        var components = URLComponents(string: "puls://group-preview")!
                        components.queryItems = [.init(name: "code", value: code.trimmingCharacters(in: .whitespacesAndNewlines))]
                        if let url = components.url { app.groupsPreview.open(url) }
                    }
                }
                if let error = app.groupsPreview.error { Text(error).foregroundStyle(.red).font(.footnote) }
            } header: { Text("Try an invitation") } footer: {
                Text("Synthetic examples. Group choices are separate from your personal database and reset when the app closes. Email, text and QR invitations use the same review flow.")
            }
            Section("Personal databases") {
                Text(app.appliedConfig.serverURL?.host ?? "No personal database connected")
                Text("Your personal sync keeps its own data selection and history.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Groups")
        .sheet(item: $invitation) { group in
            NavigationStack { GroupJoinPreviewView(group: group) }
        }
    }
}

struct GroupJoinPreviewView: View {
    let group: PreviewGroup
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var disabled: Set<String> = []
    @State private var stage = 0
    @State private var healthChoice = true

    private var alreadyJoined: Bool { app.groupsPreview.memberships.contains { $0.id == group.id } }
    private var selected: Set<String> { Set(group.metrics).subtracting(disabled) }

    var body: some View {
        List {
            Section {
                Label("Preview · nothing is collected", systemImage: "flask")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if alreadyJoined {
                Section {
                    Label("You’re in \(group.name)", systemImage: "checkmark.circle.fill").font(.title2.bold())
                    Text("Manage each data type or leave at any time in Sync → Groups.")
                    Text("Preview only. No enrollment or upload took place.").font(.footnote).foregroundStyle(.secondary)
                    Button("Done") { dismiss() }.accessibilityIdentifier("groups.done")
                }
            } else if stage == 1 {
                Section {
                    Label("Choose Health access", systemImage: "heart.text.square").font(.title2.bold())
                    Text("In the finished app, iOS asks which requested data PulsHealth may read. You can decline. Health access alone does not join the group.")
                    Toggle("Simulate data available", isOn: $healthChoice)
                    Text("This preview does not open Health permissions or read your data.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    Button("Join group") {
                        app.groupsPreview.join(group, enabled: healthChoice ? selected : [])
                        if !healthChoice { stage = 2 }
                    }.disabled(selected.isEmpty).accessibilityIdentifier("groups.join")
                    Button("Back") { stage = 0 }
                }
            } else if stage == 2 {
                Section {
                    ContentUnavailableView("No data selected", systemImage: "heart.slash",
                        description: Text("You haven’t joined. You can review your choices or close the invitation."))
                    Button("Review choices") { stage = 0 }
                }
            } else {
                GroupSummaryPreview(group: group)
                Section {
                    ForEach(group.metrics, id: \.self) { metric in
                        Toggle(metric, isOn: Binding(get: { !disabled.contains(metric) }, set: {
                            if $0 { disabled.remove(metric) } else { disabled.insert(metric) }
                        }))
                    }
                } header: { Text("Requested data") } footer: {
                    Text("The organizer sets the request. Turn off anything you don’t want to share, now or later. This may affect participation; contact the organizer.")
                }
                Section {
                    Text("By joining, you agree to share the selected data with \(group.organizer) for the dates above.")
                        .font(.footnote)
                    Button("Continue") { stage = 1 }.disabled(selected.isEmpty)
                        .accessibilityIdentifier("groups.continue")
                }
            }
        }
        .navigationTitle("Join group")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
    }
}

private struct GroupSummaryPreview: View {
    let group: PreviewGroup
    var body: some View {
        Section {
            Image(systemName: "person.2.circle.fill").font(.system(size: 48)).foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text(group.name).font(.title.bold())
            Text(group.organizer).font(.headline)
            Text(group.purpose).foregroundStyle(.secondary)
        }
        Section("Sharing details") {
            LabeledContent("Data dates", value: group.window)
            LabeledContent("Sharing ends", value: group.ends)
            LabeledContent("Recipient", value: group.organizer)
            LabeledContent("Stored with", value: group.destination)
            Text(group.retention).font(.footnote).foregroundStyle(.secondary)
            Text("Leaving stops future sharing. It doesn’t erase copies the organizer already received.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}

struct GroupMembershipPreviewView: View {
    let group: PreviewGroup
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLeave = false
    private var membership: PreviewMembership? { app.groupsPreview.memberships.first { $0.id == group.id } }

    var body: some View {
        List {
            Section {
                Label("Preview · nothing is collected", systemImage: "flask").font(.footnote).foregroundStyle(.secondary)
                Text(membership?.enabled.isEmpty == true ? "Sharing off" : "Sharing selected in preview")
            }
            Section {
                ForEach(group.metrics, id: \.self) { metric in
                    Toggle(metric, isOn: Binding(get: { membership?.enabled.contains(metric) == true }, set: {
                        app.groupsPreview.setEnabled(metric, in: group.id, enabled: $0)
                    }))
                }
            } header: { Text("Shared data") } footer: {
                Text("Changes apply to this group only. Turning off all types pauses sharing without leaving.")
            }
            GroupSummaryPreview(group: group)
            Section {
                Button("Leave group", role: .destructive) { confirmLeave = true }
            }
        }
        .navigationTitle(group.name)
        .confirmationDialog("Leave \(group.name)?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave group", role: .destructive) { app.groupsPreview.leave(group.id); dismiss() }
        } message: {
            Text("Future sharing stops for this group only. Previously received data follows the organizer’s retention policy.")
        }
    }
}
#endif
