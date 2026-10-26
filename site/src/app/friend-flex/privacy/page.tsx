import Link from "next/link";
import { notFound } from "next/navigation";
import { RepoMarkdown, readRepoFile, stripLeadingH1 } from "@/lib/markdown";

const POLICY_PATH = "site/content/friend-flex/privacy-policy.md";

const description =
  "Privacy policy for Friend Flex, a fitness challenge app for small groups of friends. Friend Flex is a separate app from PulsHealth, by the same developer.";

export const metadata = {
  title: "Friend Flex Privacy Policy",
  description,
  alternates: {
    canonical: "/friend-flex/privacy/",
  },
  // Not PulsHealth: don't inherit the site's PulsHealth share card.
  openGraph: { title: "Friend Flex Privacy Policy", description, url: "/friend-flex/privacy/" },
  twitter: { card: "summary", title: "Friend Flex Privacy Policy", description },
};

/**
 * Privacy policy for Friend Flex, a separate iPhone app by the same developer that
 * uses this page as its App Store Privacy Policy URL. Rendered from
 * `site/content/friend-flex/privacy-policy.md`: edit the Markdown, not this file.
 */
export default function FriendFlexPrivacyPage() {
  const raw = readRepoFile(POLICY_PATH);
  if (!raw) notFound();

  const { body } = stripLeadingH1(raw);
  const effective = body.match(/\*\*Effective date: ([^*]+)\*\*/)?.[1];
  const content = body.replace(/^\s*\*\*Effective date: [^*]+\*\*\s*\n/, "");

  return (
    <main className="min-h-screen bg-background pb-20">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <p className="text-sm font-medium text-muted-foreground mb-2">Friend Flex</p>
        <h1 className="text-4xl font-bold tracking-tight mb-4">Friend Flex Privacy Policy</h1>
        {effective && <p className="text-muted-foreground mb-8">Effective date: {effective}</p>}

        <div className="prose prose-zinc dark:prose-invert max-w-none prose-a:text-brand prose-a:no-underline hover:prose-a:underline">
          <RepoMarkdown source={content} docRepoPath={POLICY_PATH} />
          <p>
            Need help with the app? See <Link href="/friend-flex/">Friend Flex support</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
