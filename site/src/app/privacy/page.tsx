import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RepoMarkdown, readRepoFile, stripLeadingH1 } from "@/lib/markdown";

const GITHUB = "https://github.com/PulsHealth/pulshealth";
const POLICY_PATH = "docs/privacy-policy.md";

export const metadata = {
  title: "Privacy Policy - PulsHealth",
  description:
    "Where your health data goes and where it does not. The developer receives no data; the app posts read-only Apple Health data to the one server you configure. The website loads no analytics.",
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
              <li>The developer receives no health data. There is no PulsHealth account, service or server.</li>
              <li>Your health data goes to exactly one place: the server you run and configure.</li>
              <li>HealthKit access is read-only. The app never writes to Apple Health.</li>
              <li>No analytics, advertising, tracking or third-party SDKs in the app.</li>
              <li>The server token normally lives in the iOS Keychain; the app stores no health samples.</li>
              <li>This website loads no analytics and sets no cookies. Its two forms send only what you type.</li>
            </ul>
          </CardContent>
        </Card>

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
