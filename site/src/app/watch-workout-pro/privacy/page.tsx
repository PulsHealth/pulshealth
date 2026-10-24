import { notFound } from "next/navigation";
import { RepoMarkdown, readRepoFile, stripLeadingH1 } from "@/lib/markdown";

const CONTENT_PATH = "site/content/watchworkoutpro/privacy-policy.md";
const socialImage = { url: "/watch-workout-pro/workout-library.jpg", width: 396, height: 860, alt: "Watch Workout Pro workout library on iPhone" };
const description = "Privacy practices for Watch Workout Pro: on-device workout creation, optional sharing, iCloud collections, and Pro subscriptions.";

export const metadata = {
  title: "Watch Workout Pro Privacy Policy",
  description,
  alternates: { canonical: "/watch-workout-pro/privacy/" },
  openGraph: { title: "Watch Workout Pro Privacy Policy", description, url: "/watch-workout-pro/privacy/", images: [socialImage] },
  twitter: { card: "summary_large_image", images: [socialImage.url], title: "Watch Workout Pro Privacy Policy", description },
};

// Product-specific content; separate from the PulsHealth app policy.
export default function WatchWorkoutProPage() {
  const raw = readRepoFile(CONTENT_PATH);
  if (!raw) notFound();
  const { body } = stripLeadingH1(raw);

  return (
    <main className="min-h-screen bg-background pb-20">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <a href="/watch-workout-pro/" className="mb-5 inline-block text-sm font-medium text-brand hover:underline">Watch Workout Pro</a>
        <h1 className="text-4xl font-bold tracking-tight mb-8">Watch Workout Pro Privacy Policy</h1>
        <div className="prose prose-zinc dark:prose-invert max-w-none prose-a:text-brand prose-a:no-underline hover:prose-a:underline">
          <RepoMarkdown source={body} docRepoPath={CONTENT_PATH} />
        </div>
      </div>
    </main>
  );
}
