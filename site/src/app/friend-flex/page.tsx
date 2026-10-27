import Image from "next/image";
import Link from "next/link";
import { Dumbbell, Heart, MessageCircle, Trophy, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./friend-flex.module.css";

const description = "Create a fitness challenge with friends. Choose your categories, log results, compete on personal improvement, and keep the group chat moving with Friend Flex for iPhone and iMessage.";
const socialImage = { url: "/friend-flex/challenge.jpg", width: 460, height: 1000, alt: "Friend Flex challenge standings and fitness categories on iPhone" };
export const metadata = {
  title: "Friend Flex — Bring your friends. Beat your best.",
  description,
  alternates: { canonical: "/friend-flex/" },
  openGraph: { title: "Friend Flex", description, url: "/friend-flex/", images: [socialImage] },
  twitter: { card: "summary_large_image", title: "Friend Flex", description, images: [socialImage.url] },
};

function Phone({ name, alt, priority = false }: { name: string; alt: string; priority?: boolean }) {
  return <div className={styles.phone}><Image src={`/friend-flex/${name}.jpg`} alt={alt} width={460} height={1000} priority={priority} sizes="(max-width: 640px) 65vw, 300px" /></div>;
}

const features = [
  { id: "challenge", icon: Dumbbell, title: "Your friends. Your challenge.", text: "Pick a challenge length from 7 to 365 days. Choose from 20 categories, including running, cycling, push-ups, strength, holds, and body measurements. Or create a category of your own. Set your house rules, choose how categories count toward the overall score, and share the invite code.", image: "pushups", alt: "Friend Flex push-ups category with standings and logged results", color: "gold" },
  { id: "progress", icon: TrendingUp, title: "A little progress. A little friendly rivalry.", text: "Category standings compare percentage improvement from each person’s own starting point. Follow your progress on a chart, see the latest results, and cheer on your friends. Each category has a winner, with an overall leaderboard for the group.", image: "progress", alt: "Mile run progress chart and improvement standings in Friend Flex", color: "blue" },
  { id: "messages", icon: MessageCircle, title: "Keep the group chat moving.", text: "Log a result, send an invite, or share a leaderboard card right in Messages. Check the standings without leaving the conversation, and give your friends another reason to show up for the next one.", image: "imessage", alt: "Friend Flex iMessage app with group leaderboard, result logging, and invite controls", color: "lilac" },
  { id: "health", icon: Heart, title: "Apple Health. When you want it.", text: "Connect Apple Health to see your personal fitness summary and get suggestions for a new body measurement or a run or ride that beats your best. You choose whether to log each result. Your additional Health summary stays on your iPhone, and nothing is automatically posted to a challenge.", image: "fitness", alt: "Friend Flex personal Fitness page with running bests, cardio fitness, and activity stats", color: "mint" },
];

export default function FriendFlexPage() {
  return <main className={styles.product}>
    <section className="border-b">
      <div className={`container mx-auto max-w-7xl px-5 ${styles.hero}`}>
        <div>
          <h1 className={styles.name}>Friend Flex</h1>
          <p className={styles.headline}>Bring your friends.<br />Beat your best.</p>
          <p className="mt-7 max-w-lg text-xl leading-relaxed text-muted-foreground">Turn getting fitter into a challenge you share with friends. Pick what to measure, log your results, and compete on getting better from your own starting point.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><a href="#challenge">Explore the app</a></Button>
            <Button asChild size="lg" variant="outline"><Link href="/friend-flex/support/">Get support</Link></Button>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">Free, with no ads or subscription. iPhone and iCloud required.</p>
        </div>
        <div className={styles.heroVisual}>
          <Phone name="challenge" alt="Friend Flex overall leaderboard for the Friends in Motion demo challenge" priority />
          <div className={styles.challengeNote}><Trophy aria-hidden /><p>A reason to keep going.</p><span>Different starting points. Something to work toward together.</span></div>
        </div>
      </div>
      <nav aria-label="Friend Flex features" className="container mx-auto flex max-w-7xl flex-wrap justify-between gap-4 border-t px-5 py-6 text-sm font-medium md:text-base">
        <a href="#challenge">Create a challenge</a><a href="#progress">See your progress</a><a href="#messages">Share in iMessage</a><a href="#health">Connect Apple Health</a>
      </nav>
    </section>

    <div className="container mx-auto max-w-6xl space-y-24 px-5 py-20 md:space-y-32 md:py-28">
      <section>
        <h2 className={styles.sectionTitle}>A shared goal.<br />Your own starting line.</h2>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">You don’t have to be the fastest runner or do the most push-ups to make progress. Friend Flex scores improvement from where you began, so everyone has something to aim for.</p>
        <ol className={styles.steps}>
          <li><h3>1. Make it yours</h3><p>Choose your categories, dates, and rules.</p></li>
          <li><h3>2. Bring your friends</h3><p>Share a six-character code to join with iCloud. No separate app account.</p></li>
          <li><h3>3. Keep improving</h3><p>Log results and follow the group’s standings.</p></li>
        </ol>
      </section>
      {features.map(({ id, icon: Icon, title, text, image, alt, color }, i) => <section key={id} id={id} className={styles.feature}>
        <div className={i % 2 === 0 ? styles.copyAfter : undefined}>
          <Icon className="mb-5 h-8 w-8 text-brand" aria-hidden /><h2 className={styles.sectionTitle}>{title}</h2>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">{text}</p>
          {id === "health" && <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">Apple Health and Apple Watch are optional. Friend Flex never writes to Health. Results you choose to log are saved in iCloud like manually entered results.</p>}
        </div>
        <div className={`${styles.featureVisual} ${styles[color]}`}><Phone name={image} alt={alt} /></div>
      </section>)}

      <section className="border-t pt-12">
        <h2 className="text-2xl font-semibold tracking-tight">Ready for a little friendly competition?</h2>
        <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">Friend Flex is a separate iPhone app by the developer of PulsHealth. Previously called Fun 100, it keeps your existing challenges, results, and invite codes.</p>
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4 font-medium text-brand">
          <Link href="/friend-flex/support/" className="hover:underline">Get help with Friend Flex</Link>
          <Link href="/friend-flex/privacy/" className="hover:underline">Read the privacy policy</Link>
          <a href="mailto:support@pulshealth.com?subject=Friend%20Flex%20support" className="hover:underline">Email support</a>
        </div>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-muted-foreground">Logged results are visible to your challenge members and stored in a public iCloud database. Other Friend Flex users could technically access these records; only log information you’re comfortable sharing.</p>
      </section>
    </div>
  </main>;
}
