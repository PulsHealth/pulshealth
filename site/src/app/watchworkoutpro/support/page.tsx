import { notFound } from "next/navigation";
import { RepoMarkdown, readRepoFile, stripLeadingH1 } from "@/lib/markdown";

const CONTENT_PATH = "site/content/watchworkoutpro/support.md";
const description = "Help with Watch Workout Pro, Smart Add, Apple Watch scheduling, sharing, and the Pro monthly subscription.";

export const metadata = {
  title: "Watch Workout Pro Support",
  description,
  alternates: { canonical: "/watchworkoutpro/support/" },
  openGraph: { title: "Watch Workout Pro Support", description, url: "/watchworkoutpro/support/" },
  twitter: { card: "summary", title: "Watch Workout Pro Support", description },
};

// Separate product pages, intentionally unlisted in navigation, search, and sitemap.
export default function WatchWorkoutProPage() {
  const raw = readRepoFile(CONTENT_PATH);
  if (!raw) notFound();
  const { body } = stripLeadingH1(raw);

  return (
    <main className="min-h-screen bg-background pb-20">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <p className="text-sm font-medium text-muted-foreground mb-2">Watch Workout Pro · Powered by Puls</p>
        <h1 className="text-4xl font-bold tracking-tight mb-8">Watch Workout Pro Support</h1>
        <div className="prose prose-zinc dark:prose-invert max-w-none prose-a:text-brand prose-a:no-underline hover:prose-a:underline">
          <RepoMarkdown source={body} docRepoPath={CONTENT_PATH} />
        </div>
      </div>
    </main>
  );
}
