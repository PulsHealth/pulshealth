import type { ReactNode } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/page-hero";

const SUPPORT_EMAIL = "support@pulshealth.com";

const description =
  "Help with Friend Flex, a fitness challenge app for small groups of friends: how it works, common questions, and how to reach support. Friend Flex is a separate app from PulsHealth, by the same developer.";

export const metadata = {
  title: "Friend Flex Support",
  description,
  alternates: {
    canonical: "/friend-flex/",
  },
  // Not PulsHealth: don't inherit the site's PulsHealth share card.
  openGraph: { title: "Friend Flex Support", description, url: "/friend-flex/" },
  twitter: { card: "summary", title: "Friend Flex Support", description },
};

const link = "text-brand underline-offset-4 hover:underline";

const faq: { q: string; a: ReactNode }[] = [
  {
    q: "Do I need an account?",
    a: (
      <>
        No separate account. Friend Flex stores challenges and results in Apple&apos;s iCloud, so you
        need to be signed into iCloud on your iPhone. You just pick a display name and an emoji.
      </>
    ),
  },
  {
    q: "How do I join a challenge?",
    a: (
      <>
        Ask the person who created it for its 6-character code. In Friend Flex, go to the Challenges
        list, tap <strong>+</strong>, choose <strong>Join with Code</strong> and enter the code.
      </>
    ),
  },
  {
    q: "Do I have to connect Apple Health?",
    a: (
      <>
        No, it&apos;s optional. If you connect it, Friend Flex uses it to show stats on your own Fitness
        page and to offer one-tap logging of a new weigh-in, body measurement or a fast run or ride. Health data stays
        on your iPhone. Nothing from Apple Health is uploaded unless you tap to log a specific
        result, and then only that result is saved. Friend Flex never writes to Apple Health.
      </>
    ),
  },
  {
    q: "How do I delete my data?",
    a: (
      <>
        In the app, go to <strong>Settings → Delete My Data</strong>. That deletes your profile,
        your logged results and your fitness summary, and removes you from all challenges.
        Challenges you created stay for their other members; email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>
          {SUPPORT_EMAIL}
        </a>{" "}
        if you want one removed.
      </>
    ),
  },
  {
    q: "How do I report someone or a problem?",
    a: (
      <>
        Open the person&apos;s page, or the challenge&apos;s <strong>⋯</strong> menu, and choose{" "}
        <strong>Report</strong>. Or email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>
          {SUPPORT_EMAIL}
        </a>
        .
      </>
    ),
  },
];

/**
 * Support page for Friend Flex, a separate iPhone app by the same developer that
 * uses this page as its App Store Support URL. Linked from the footer, search and sitemap.
 */
export default function FriendFlexSupportPage() {
  return (
    <main className="flex flex-1 flex-col">
      <PageHero
        size="compact"
        title="Friend Flex Support"
        lede="Friend Flex is an iPhone app for running a fitness challenge with a small group of friends."
        note={
          <>
            Friend Flex is not part of PulsHealth. It is a separate app by the same developer, and its
            support page lives on this site for that reason.
          </>
        }
      >
        <Button asChild size="lg">
          <a href={`mailto:${SUPPORT_EMAIL}`}>
            <Mail className="h-4 w-4" />
            Email {SUPPORT_EMAIL}
          </a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/friend-flex/privacy/">Privacy Policy</Link>
        </Button>
      </PageHero>

      <section className="container mx-auto max-w-3xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight mb-4">What Friend Flex is</h2>
        <div className="space-y-4 text-muted-foreground text-pretty">
          <p>
            A fitness challenge for small groups of friends. Choose from 20 fitness and body-measurement categories, or add a custom category.
          </p>
          <p>
            Everyone is scored on their percentage improvement from their own start, so it&apos;s
            fair whatever shape you&apos;re in on day one. There is an overall winner and a winner
            in each category.
          </p>
          <p>
            There is also a Friend Flex iMessage app, for logging a result and checking the leaderboard
            without leaving the group chat.
          </p>
        </div>

        <h2 className="text-2xl font-bold tracking-tight mt-12 mb-4">Getting help</h2>
        <p className="text-muted-foreground text-pretty">
          Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>
            {SUPPORT_EMAIL}
          </a>{" "}
          with your question or problem. If it&apos;s about a specific challenge, including its
          name or code helps.
        </p>

        <h2 className="text-2xl font-bold tracking-tight mt-12 mb-6">Frequently asked</h2>
        <dl className="divide-y rounded-lg border bg-card">
          {faq.map((item) => (
            <div key={item.q} className="px-5 py-5">
              <dt className="font-semibold text-foreground">{item.q}</dt>
              <dd className="mt-2 text-muted-foreground text-pretty">{item.a}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-8 text-sm text-muted-foreground">
          What Friend Flex stores, who can see it and how to delete it:{" "}
          <Link href="/friend-flex/privacy/" className={link}>
            Friend Flex Privacy Policy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
