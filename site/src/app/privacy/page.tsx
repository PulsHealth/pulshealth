import { notFound } from "next/navigation";
import { GitHubIcon } from "@/components/brand-icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RepoMarkdown, readRepoFile, stripLeadingH1 } from "@/lib/markdown";

const GITHUB = "https://github.com/PulsHealth/pulshealth";
const POLICY_PATH = "docs/privacy-policy.md";
const BLOB = `${GITHUB}/blob/main`;

/** The claims the policy rests on, each with the code that backs it. */
const claims = [
  {
    title: "Your exports go where you choose",
    body: "Exploring and exporting need no account. An export goes where you choose in the share sheet, or to a request destination you review and approve with Generate & Send. Apple handles any App Store rating or review you choose to submit; review timing counters stay on your device.",
    check: { label: "Export/", href: `${GITHUB}/tree/main/PulsHealthSync/Sources/PulsHealthSync/Export` },
  },
  {
    title: "Your database, or ours: your choice",
    body: "Regular sync uploads to the database you set up. One-time requests can send a ZIP to a separate HTTPS destination you approve. Run your own and the developer never sees your data. Choose the PulsHealth database and we hold it under your account, to show it back to you and to the assistants you connect. It is not sold. Account deletion disconnects access and automatically removes your account and stored records; a private status link confirms completion. A minimal deletion record prevents older backups from restoring deleted data.",
    check: { label: "Transport/", href: `${GITHUB}/tree/main/PulsHealthSync/Sources/PulsHealthSync/Transport` },
  },
  {
    title: "Zero third-party dependencies in the app",
    body: "No analytics SDK, no crash reporter, no ad library. The Swift package and the app depend on Apple frameworks and nothing else.",
    check: { label: "Package.swift", href: `${BLOB}/PulsHealthSync/Package.swift` },
  },
  {
    title: "Read-only, in the code",
    body: "The app asks HealthKit for read permission only and never writes, edits or deletes. The usage strings say so, and the code shows it.",
    check: { label: "HealthSyncEngine.swift", href: `${BLOB}/PulsHealthSync/Sources/PulsHealthSync/Engine/HealthSyncEngine.swift` },
  },
];

export const metadata = {
  title: "Privacy Policy - PulsHealth",
  description:
    "Where your health data goes and where it does not. Sync goes to your configured database. One-time exports go through the share sheet or to a request destination you approve. The website loads no analytics.",
  alternates: {
    canonical: "/privacy/",
  },
};

/**
 * This page renders `docs/privacy-policy.md` from the repository, so the
 * policy the App Store links to and the one in version control are the same
 * document. Edit the Markdown, not this file.
 */
export default function PrivacyPage() {
  const raw = readRepoFile(POLICY_PATH);
  if (!raw) notFound();

  const { body } = stripLeadingH1(raw);
  const updated = body.match(/\*\*Last updated: ([^*]+)\*\*/)?.[1];
  const content = body.replace(/^\s*\*\*Last updated: [^*]+\*\*\s*\n/, "");

  return (
    <main className="min-h-screen bg-background pb-20">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-4xl font-bold tracking-tight mb-4">Privacy Policy</h1>
        {updated && <p className="text-muted-foreground mb-8">Last updated: {updated}</p>}

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Privacy at a glance</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-6 space-y-2">
              <li>Exploring stays on your phone. Self-hosted sync goes to your database; ordinary exports go only where you share them.</li>
              <li>If you create a PulsHealth account and sync to the PulsHealth database (with its viewer at app.pulshealth.com), your data is stored under your account. The operator can access it; hosting is not end-to-end encrypted. Account deletion disconnects access and automatically removes your account and stored records; a private status link confirms completion. A minimal deletion record prevents older backups from restoring deleted data. Creating an account also sends the signup details described below.</li>
              <li>With the PulsHealth database you can connect an AI assistant, such as Claude, to your records by signing in and approving it. It gets read-only access to your health data and profile until you revoke it on your account page (its current access then runs out within 30 minutes), and its provider receives what it reads under the provider&rsquo;s own terms. The app is not involved, and the developer sends your data to no AI provider on its own.</li>
              <li>You choose each way health data leaves the phone: sync to your configured database, exports you share yourself, or one-time ZIP delivery to a request destination you review and approve. Opening a request alone sends nothing.</li>
              <li>HealthKit access is read-only. The app never writes to Apple Health.</li>
              <li>No analytics, advertising, tracking or third-party SDKs in the app.</li>
              <li>The bearer token normally lives in the iOS Keychain. The app does not retain synced health samples: an export you ask for is staged in temporary storage until you share it or confirm request delivery, then deleted, and the per-type analysis it keeps holds only summary numbers (counts, dates, a histogram, per-source counts), deletable in one tap.</li>
              <li>This website loads no analytics and sets no cookies. Its two forms send only what you type.</li>
            </ul>
          </CardContent>
        </Card>

        <section aria-labelledby="check-it" className="mb-10">
          <h2 id="check-it" className="text-xl font-semibold tracking-tight">Check it in the code</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            The app is open source, so each of these links to the code behind it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {claims.map((claim) => (
              <div key={claim.title} className="flex flex-col rounded-xl border bg-card p-4">
                <h3 className="font-semibold">{claim.title}</h3>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">{claim.body}</p>
                <a
                  href={claim.check.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-brand hover:underline"
                >
                  <GitHubIcon className="h-3.5 w-3.5" />
                  check: {claim.check.label}
                </a>
              </div>
            ))}
          </div>
        </section>

        <div className="prose prose-zinc dark:prose-invert max-w-none prose-a:text-brand prose-a:no-underline hover:prose-a:underline">
          <p>
            The canonical, version-controlled copy of this policy is{" "}
            <a href={`${GITHUB}/blob/main/${POLICY_PATH}`} target="_blank" rel="noopener noreferrer">
              <code>{POLICY_PATH}</code>
            </a>{" "}
            in the public repository. This page is rendered from that file at build time, so the
            two cannot drift apart.
          </p>
          <RepoMarkdown source={content} docRepoPath={POLICY_PATH} />
        </div>
      </div>
    </main>
  );
}
