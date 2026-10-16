import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Lock, EyeOff, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppStoreBadge, APP_STORE_URL } from "@/components/app-store-badge";
import { SignalLab } from "@/components/signal-lab";
import { AiChatPreview } from "@/components/ai-chat-preview";
import { FaqList } from "@/components/faq-list";
import { getAllTypes } from "@/lib/api";
import { faq } from "@/lib/faq";
import { GITHUB_URL } from "@/lib/github";
import styles from "./home.module.css";

const SIGNUP_URL = "https://app.pulshealth.com/signup";
const DEMO_URL = "https://app.pulshealth.com/demo";
const textLink = "inline-flex items-center gap-2 font-medium text-brand underline-offset-4 hover:underline";

const appJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "PulsHealth",
  operatingSystem: "iOS 17 or later",
  applicationCategory: "HealthApplication",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  installUrl: APP_STORE_URL,
  license: "https://www.apache.org/licenses/LICENSE-2.0",
  codeRepository: GITHUB_URL,
  isAccessibleForFree: true,
  description: "Sync, export, and control your Apple Health data. Automatic background sync to a compatible database, flexible CSV and JSON exports, and connections to compatible AI tools through your database. Free to download and open source, with optional Pro subscriptions for full history and unlimited sync types.",
};

function Feature({ id, title, intro, children, visual, flip = false }: {
  id: string; title: string; intro: string; children: ReactNode; visual: ReactNode; flip?: boolean;
}) {
  return (
    <section id={id} className={`${styles.feature} grid scroll-mt-24 items-center gap-10 lg:grid-cols-2 lg:gap-20`}>
      <div className={flip ? "lg:order-2" : undefined}>
        <h2 className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-tight text-balance md:text-5xl">{title}</h2>
        <p className="mt-5 text-xl font-medium text-foreground">{intro}</p>
        <div className="mt-4 max-w-lg space-y-5 text-lg leading-relaxed text-muted-foreground text-pretty">{children}</div>
      </div>
      <div className={`min-w-0 ${flip ? "lg:order-1" : ""}`}>{visual}</div>
    </section>
  );
}

export default async function HomePage() {
  const kbCount = (await getAllTypes()).length;
  return (
    <main className={styles.home}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />

      <section className={styles.hero}>
        <div className="container mx-auto grid max-w-7xl items-center gap-12 px-5 py-14 md:py-20 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:py-24">
          <div>
            <h1 className="max-w-xl text-[clamp(3.5rem,7vw,6.5rem)] font-medium leading-[0.98] tracking-[-0.065em]">
              Unlock your health data.
            </h1>
            <p className="mt-7 max-w-lg text-2xl font-medium leading-snug text-balance">
              Sync, export, and control your Apple Health data.
            </p>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground text-pretty">
              Explore your health in the PulsHealth web app. Keep your database in sync, export what matters, and connect the AI tools you choose.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <AppStoreBadge className="[&_img]:h-12" />
              <Button asChild variant="outline" size="lg" className="h-12">
                <a href={DEMO_URL}>Try the dashboard <ArrowRight className="ml-1 h-4 w-4" aria-hidden /></a>
              </Button>
            </div>
            <p className="mt-5 text-base font-medium leading-relaxed text-foreground/85 sm:text-lg">
              <span className="whitespace-nowrap">Free to start</span>{" "}
              <span aria-hidden="true">·</span>{" "}
              <span className="whitespace-nowrap">Open source</span>{" "}
              <span aria-hidden="true">·</span>{" "}
              <span className="whitespace-nowrap">No Account Required</span>
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Full history and sync for all supported types with <Link href="/pro" className="text-brand hover:underline">PulsHealth Pro</Link>. Your database stays yours.
            </p>
          </div>
          <SignalLab />
        </div>
        <nav aria-label="Explore PulsHealth features" className="container mx-auto flex max-w-7xl flex-wrap justify-between gap-4 border-t px-5 py-6 text-base font-medium md:text-lg">
          <a href="#web-app" className={styles.featureLink}>Explore the dashboard <ArrowRight aria-hidden /></a>
          <a href="#sync" className={styles.featureLink}>Keep it in sync <ArrowRight aria-hidden /></a>
          <a href="#export" className={styles.featureLink}>Make it portable <ArrowRight aria-hidden /></a>
          <a href="#ai" className={styles.featureLink}>Put it to work <ArrowRight aria-hidden /></a>
        </nav>
      </section>

      <div id="how-it-works" className="container mx-auto max-w-7xl scroll-mt-24 space-y-24 px-5 py-20 md:space-y-32 md:py-28">
        <section id="web-app" className="scroll-mt-24">
          <div className="mb-10 grid items-end gap-6 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
            <div>
              <h2 className="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight text-balance md:text-6xl">Your health, with room to explore.</h2>
              <p className="mt-5 max-w-2xl text-xl leading-relaxed text-muted-foreground">The PulsHealth web app turns your synced data into a place to see your day, explore your history, and look closer at every workout.</p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Button asChild size="lg"><a href={DEMO_URL}>Try the dashboard <ArrowRight className="ml-1 h-4 w-4" aria-hidden /></a></Button>
              <Button asChild size="lg" variant="outline"><a href={SIGNUP_URL}>Request an account</a></Button>
            </div>
          </div>
          <SignalLab variant="chart" />
          <div className="mt-9 grid gap-8 md:grid-cols-3">
            <div><h3 className="text-xl font-semibold">Your day, at a glance</h3><p className="mt-2 leading-relaxed text-muted-foreground">Activity rings, sleep, heart rate, and your latest readings together in one dashboard.</p></div>
            <div><h3 className="text-xl font-semibold">See the bigger picture</h3><p className="mt-2 leading-relaxed text-muted-foreground">Explore interactive charts across days, months, or years. Zoom in on the details that interest you.</p></div>
            <div><h3 className="text-xl font-semibold">Go deeper into workouts</h3><p className="mt-2 leading-relaxed text-muted-foreground">Browse your sessions, then explore routes, heart rate zones, splits, and more.</p></div>
          </div>
          <p className="mt-8 text-base text-muted-foreground">Use the web app with an approved PulsHealth account, or <Link href="/server" className="text-brand hover:underline">run it with your own database</Link>.</p>
        </section>

        <Feature id="sync" title="Keep your database in sync." intro="Your history, with new data flowing in." visual={
          <SignalLab variant="sync" />
        }>
          <p>Build a personal health archive that keeps growing. Start free with five health data types from the last 30 days, then keep them up to date with automatic background sync.</p>
          <p>Your database powers the web app and your connected AI tools. You can also build your own dashboards or query your data directly.</p>
          <p className="text-base">Connect your own PulsHealth server or a compatible receiver. Prefer hosting? <a href={SIGNUP_URL} className="text-brand underline-offset-4 hover:underline">Request a PulsHealth account</a>.</p>
          <Link href="/server" className={textLink}>Explore self-hosting <ArrowRight className="h-4 w-4" aria-hidden /></Link>
        </Feature>

        <Feature id="export" title="Export what matters." intro="Your data, dates, and format." flip visual={
          <SignalLab variant="export" />
        }>
          <p>Choose the measurements and time range you need. Export the last 30 days free, or your full available history with Pro. Use CSV for spreadsheets or JSON for your own tools and projects.</p>
          <p>Save a personal archive, share a file, or take your data into a new workflow. No account or database required.</p>
          <a href={APP_STORE_URL} className={textLink}>Get the app <ArrowRight className="h-4 w-4" aria-hidden /></a>
        </Feature>

        <Feature id="iphone" title="Your health. In every detail." intro="Individual readings or custom summaries." visual={
          <SignalLab variant="detail" />
        }>
          <p>Sleep, heart rate, activity, workouts, nutrition, and more. Explore what Apple Health records and choose what you want to keep.</p>
          <p>Keep individual readings or create custom aggregations, from hourly averages to daily totals. Get the level of detail that works for you.</p>
          <Link href="/knowledge-base" className={textLink}>Discover {kbCount} health data types <ArrowRight className="h-4 w-4" aria-hidden /></Link>
        </Feature>

        <Feature id="ai" title="Bring your health data to AI." intro="Your database. Your AI tools. Your choice." flip visual={<AiChatPreview />}>
          <p>Ask how your sleep has changed. Compare your workouts. Explore the patterns in your activity over time.</p>
          <p>Connect a compatible assistant to your PulsHealth database and let it work from your own data. You choose which tools get access.</p>
          <p className="text-base">Works with compatible MCP clients, including ChatGPT and Claude.</p>
          <Link href="/docs/ai" className={textLink}>Connect your AI tools <ArrowRight className="h-4 w-4" aria-hidden /></Link>
        </Feature>
      </div>

      <section className={styles.control}>
        <div className="container mx-auto max-w-7xl px-5 py-20 md:py-24">
          <h2 className="text-4xl font-semibold tracking-tight md:text-5xl">Built for control.</h2>
          <p className="mt-5 max-w-2xl text-xl leading-relaxed text-muted-foreground">Choose what to sync, what to export, and where it goes.</p>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            <div><SlidersHorizontal className="mb-4 h-6 w-6 text-brand" aria-hidden /><h3 className="text-xl font-semibold">Choose where it lives</h3><p className="mt-3 leading-relaxed text-muted-foreground">Keep files wherever you want. Run your own database, connect a compatible receiver, or use an approved PulsHealth account.</p></div>
            <div><Lock className="mb-4 h-6 w-6 text-brand" aria-hidden /><h3 className="text-xl font-semibold">Apple Health stays yours</h3><p className="mt-3 leading-relaxed text-muted-foreground">PulsHealth reads your records without changing them. Exploring stays on your phone; you decide what to share.</p></div>
            <div><EyeOff className="mb-4 h-6 w-6 text-brand" aria-hidden /><h3 className="text-xl font-semibold">Open source. No tracking.</h3><p className="mt-3 leading-relaxed text-muted-foreground">No ads or analytics in the app. Open-source code you can inspect, use, and build on.</p></div>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-4">
            <Link href="/privacy" className={textLink}>Read the privacy policy <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            <a href={GITHUB_URL} className={textLink}>Explore the source <ArrowRight className="h-4 w-4" aria-hidden /></a>
          </div>
        </div>
      </section>

      <section className="container mx-auto max-w-3xl px-5 py-20 md:py-24">
        <h2 className="mb-8 text-3xl font-semibold tracking-tight md:text-4xl">A few things to know.</h2>
        <FaqList items={faq.filter((item) => item.home)} />
        <p className="mt-6 text-muted-foreground">More answers on the <Link href="/support" className="text-brand hover:underline">support page</Link>.</p>
      </section>

      <section className={styles.closing}>
        <div className="container mx-auto max-w-7xl px-5 py-20 text-center md:py-24">
          <h2 className="text-4xl font-semibold tracking-tight md:text-6xl">Your data. Your next possibility.</h2>
          <p className="mx-auto mb-8 mt-5 max-w-xl text-xl leading-relaxed text-muted-foreground">Start with a single export. Build your own health archive. Make more of the data you already have.</p>
          <AppStoreBadge className="inline-block" />
          <p className="mt-5 text-sm text-muted-foreground">Free to explore and export. No account needed.</p>
        </div>
      </section>
    </main>
  );
}
