import SwiftUI

/// The Sync tab before any database is applied: what syncing does — the
/// app's headline feature, so it says so — then the two places the data can
/// go, each a card with its one way on. Sections for the tab's `List`, so it
/// sits with the tab's links below it in the same inset-grouped style.
///
/// Neither card applies anything: both open Sync → Database with that option
/// already chosen (`choose`), where signing in or pairing, the developer's
/// disclosure and Save & Apply all stay as they are.
struct SyncIntro: View {
    /// Opens the Database screen with this option chosen.
    let choose: (DatabaseDestination) -> Void

    /// How to run your own database: the server documentation's setup
    /// section, opened in Safari.
    static let selfHostURL = URL(string: "https://pulshealth.com/docs/server/#setup")!

    @State private var heroAppeared = false

    var body: some View {
        hero
        highlights
        choices
    }

    // MARK: - Hero

    private var hero: some View {
        Section {
            VStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(.tint.opacity(0.12))
                        .frame(width: 96, height: 96)
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 44, weight: .semibold))
                        .foregroundStyle(.tint)
                        .symbolEffect(.bounce, value: heroAppeared)
                }
                .accessibilityHidden(true)
                Text("Always in Sync")
                    .font(.title.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("PulsHealth keeps a live copy of your Health data in a database. New data syncs by itself in the background, so it is always up to date and yours to use however you like.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 8))
        }
        .onAppear { heroAppeared = true }
    }

    // MARK: - What syncing does

    private var highlights: some View {
        Section {
            highlight(
                "bolt.heart.fill", .pink, "Automatic",
                "New readings sync as Apple Health records them. Nothing to remember, nothing to export.")
            highlight(
                "clock.arrow.circlepath", .orange, "Your Whole History",
                "The first sync brings over your past data, then it keeps up from there.")
            highlight(
                "sparkles", .purple, "Use It Your Way",
                "Ask Claude or another AI assistant, browse it on the web, or query it with SQL.")
            highlight(
                "hand.raised.fill", .blue, "You Stay in Control",
                "Choose which data syncs and where it goes. Disconnect any time.")
        }
    }

    private func highlight(_ symbol: String, _ color: Color, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(color.gradient, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Where it goes

    @ViewBuilder private var choices: some View {
        choiceCard(
            symbol: "person.crop.circle.fill", color: .accentColor,
            title: "PulsHealth Database",
            detail: "Hosted for you. Sign in to start syncing, see your data at app.pulshealth.com, and connect your AI assistant.",
            header: "Choose Where to Sync"
        ) {
            Button {
                choose(.pulsHealth)
            } label: {
                Text("Sign In or Create Account")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        choiceCard(
            symbol: "externaldrive.connected.to.line.below.fill", color: .green,
            title: "Your Own Database",
            detail: "Run the open-source PulsHealth server on a computer or cloud you control, and connect to it with its pairing code.",
            footer: "Optional. Exploring and exporting never need a database, and you can switch later."
        ) {
            VStack(spacing: 10) {
                Button {
                    choose(.own)
                } label: {
                    Text("Connect Your Database")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                // Opens in Safari, like the app's other documentation links.
                Link(destination: Self.selfHostURL) {
                    HStack(spacing: 5) {
                        Text("How to Set One Up")
                        Image(systemName: "arrow.up.right")
                            .imageScale(.small)
                    }
                    .font(.subheadline)
                }
                // Borderless, or a list row with two controls sends a tap
                // anywhere in it to both.
                .buttonStyle(.borderless)
            }
        }
    }

    private func choiceCard<Actions: View>(
        symbol: String, color: Color, title: String, detail: String,
        header: String? = nil, footer: String? = nil,
        @ViewBuilder actions: () -> Actions
    ) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: symbol)
                        // The Database screen's symbols for the same two
                        // choices, so the card and the row it opens match.
                        .font(.system(size: 30))
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(color)
                        .frame(width: 40)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title).font(.title3.bold())
                        Text(detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                actions()
            }
            .padding(.vertical, 8)
        } header: {
            if let header { Text(header) }
        } footer: {
            if let footer { Text(footer) }
        }
    }
}
