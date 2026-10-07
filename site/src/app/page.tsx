import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  Database,
  EyeOff,
  Globe,
  Lock,
  ShieldCheck,
  Smartphone,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppStoreBadge } from "@/components/app-store-badge";
import { AiChatPreview } from "@/components/ai-chat-preview";
import { getAllTypes } from "@/lib/api";
import { faq } from "@/lib/faq";
import { GITHUB_URL, formatStars, getRepoStats } from "@/lib/github";

/** The hosted database's sign-up page, on the viewer's origin. */
const SIGNUP_URL = "https://app.pulshealth.com/signup";

const textLink = "font-medium text-brand underline-offset-4 hover:underline";

/** "How it works": the one flow every way of using PulsHealth shares. */
const steps = [
  {
    icon: Smartphone,
    title: "The app reads Apple Health",
    body: "Free and read-only, on your iPhone. Explore every type, or export CSV and JSONL, with no account.",
    more: (
      <a href="#iphone" className={`inline-flex items-center ${textLink}`}>
        On your iPhone <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </a>
    ),
  },
  {
    icon: Database,
    title: "It syncs to your database",
    body: "Your whole history first, then it keeps up in the background.",
    more: (
      <span className="text-muted-foreground">
        <a href={SIGNUP_URL} className={textLink}>Hosted for you</a>, or{" "}
        <Link href="/server" className={textLink}>run your own</Link>.
      </span>
    ),
  },
  {
    icon: Bot,
    title: "You and your AI use it",
    body: "Browse it in the web viewer, ask Claude about it, or pull it into a notebook or spreadsheet.",
    more: (
      <Link href="/docs/ai" className={`inline-flex items-center ${textLink}`}>
        Connect an assistant <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
    ),
  },
];

const prompts = [
  "Plan the next 16 weeks of marathon training from my last three months of runs, my heart rate and my HRV.",
  "Write my weekly report: training load, sleep and resting heart rate, against the month before.",
  "Where have my runs got faster this year, and what else changed around then?",
];

const privacy = [
  {
    icon: ShieldCheck,
    title: "Read-only",
    body: "The app reads Apple Health and never writes to it.",
  },
  {
    icon: Lock,
    title: "Only where you send it",
    body: "Run your own database and we never see your data. On ours it is never sold or shared.",
  },
  {
    icon: EyeOff,
    title: "No tracking",
    body: "No analytics, ads or third-party code in the app. Exploring and exporting send nothing.",
  },
];

/** A phone screenshot in a plain rounded frame. */
function Phone({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-[2rem] border-[5px] border-neutral-900 bg-neutral-900 shadow-2xl shadow-black/15 dark:border-neutral-700 dark:bg-neutral-700 dark:shadow-black/50 ${className ?? ""}`}>
      <Image src={src} alt={alt} width={600} height={1304} className="block w-full rounded-[1.6rem]" />
    </div>
  );
}

/** One "What you get" row: words on one side, a picture on the other. */
function Feature({
  id,
  icon: Icon,
  title,
  children,
  visual,
  flip,
}: {
  id?: string;
  icon: typeof Smartphone;
  title: string;
  children: ReactNode;
  visual: ReactNode;
  flip?: boolean;
}) {
  return (
    <div id={id} className="grid scroll-mt-20 items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-2" : undefined}>
        <div className="mb-4 w-fit rounded-xl bg-brand-muted p-3 text-brand">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
        <h3 className="mb-4 text-2xl font-bold tracking-tight md:text-3xl">{title}</h3>
        <div className="space-y-4 text-lg text-muted-foreground text-pretty">{children}</div>
      </div>
      <div className={flip ? "lg:order-1" : undefined}>{visual}</div>
    </div>
  );
}

export default async function HomePage() {
  const { stars } = await getRepoStats();
  const starLabel = formatStars(stars);
  const homeFaq = faq.filter((f) => f.home);
  const kbCount = (await getAllTypes()).length;

  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero */}
      <section className="w-full overflow-hidden border-b bg-gradient-to-b from-background to-muted/40">
        <div className="container mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-16 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-24">
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <Badge variant="outline" className="mb-6 rounded-full bg-background/60 px-4 py-1 text-sm backdrop-blur-sm">
              Free app &middot; Open source
            </Badge>
            <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-foreground text-balance md:text-6xl">
              Ask AI about your <span className="text-brand">Apple Health</span> data.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty md:text-xl">
              PulsHealth keeps your whole Apple Health history in a database, so you and Claude can
              work from your real numbers.
            </p>
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row">
              <AppStoreBadge />
              <Button asChild size="lg" variant="ghost">
                <a href="#how-it-works">
                  How it works
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </div>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground lg:justify-start">
              <li>No account needed</li>
              <li>Read-only</li>
              <li>No tracking</li>
              <li>
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                  <Star className="h-3.5 w-3.5" aria-hidden />
                  {starLabel ? `${starLabel} on GitHub` : "Open source on GitHub"}
                </a>
              </li>
            </ul>
          </div>

          <AiChatPreview />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="container mx-auto max-w-7xl scroll-mt-16 px-4 py-24">
        <div className="mb-14 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">How it works</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            One app keeps a database of your health data up to date. You, and the AI you choose,
            read from it.
          </p>
        </div>

        <div className="relative mx-auto max-w-5xl">
          <div
            aria-hidden
            className="absolute left-[16.67%] right-[16.67%] top-7 hidden h-px bg-brand/30 lg:block"
          />
          <ol className="relative grid gap-10 lg:grid-cols-3 lg:gap-8">
            {steps.map((step, i) => (
              <li key={step.title} className="relative flex gap-5 lg:flex-col lg:items-center lg:text-center">
                {i < steps.length - 1 && (
                  <div aria-hidden className="absolute -bottom-10 left-7 top-14 w-px bg-brand/30 lg:hidden" />
                )}
                <div className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-background text-brand shadow-sm">
                  <step.icon className="h-6 w-6" />
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground">
                    {i + 1}
                  </span>
                </div>
                <div className="min-w-0 pt-1 lg:pt-5">
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-muted-foreground text-pretty">{step.body}</p>
                  <p className="mt-3 text-sm">{step.more}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="mx-auto mt-14 max-w-2xl text-center text-sm text-muted-foreground">
          All of it is open source under Apache-2.0, and the hosted database runs the same code
          you can run yourself.
        </p>
      </section>

      {/* What you get */}
      <section className="border-y bg-muted/30">
        <div className="container mx-auto max-w-6xl space-y-28 px-4 py-24">
          <h2 className="sr-only">What you get</h2>

          <Feature
            id="iphone"
            icon={Smartphone}
            title="Explore and export on your iPhone"
            visual={
              <div className="relative mx-auto flex max-w-md justify-center gap-5 pb-8 sm:gap-6">
                <Phone
                  src="/screenshots/app-explore.webp"
                  alt="Explore tab: Apple Health types by category, each with its sample count over the past year"
                  className="w-[46%]"
                />
                <Phone
                  src="/screenshots/app-type-page.webp"
                  alt="Heart Rate's type page: description, analysis over the past year, sample counts, sources and the value distribution"
                  className="w-[46%] translate-y-8"
                />
              </div>
            }
          >
            <p>
              Every Apple Health type with a year of analysis, and a plain explanation of what it
              measures from our{" "}
              <Link href="/knowledge-base" className={textLink}>
                guide to all {kbCount} types
              </Link>
              .
            </p>
            <p>Export any types and dates to CSV or JSONL. No account, nothing leaves the phone.</p>
            <div className="pt-2">
              <AppStoreBadge />
            </div>
          </Feature>

          <Feature
            icon={Globe}
            title="Your whole history on the web"
            flip
            visual={
              <figure className="overflow-hidden rounded-xl border bg-[#0b0b0c] shadow-2xl shadow-black/20">
                <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                </div>
                <Image
                  src="/screenshots/viewer-today.webp"
                  alt="The PulsHealth web viewer showing today's activity rings, highlight tiles for steps, energy, resting heart rate, sleep, HRV, distance, VO2 max and body weight, and recent workouts."
                  width={1440}
                  height={900}
                  className="w-full"
                />
              </figure>
            }
          >
            <p>
              Once it syncs, every sample lands in a database: rings, trends, sleep and workouts,
              years of them, in a web viewer.
            </p>
            <p>
              Use the PulsHealth database, hosted for you, or run your own with one script.
            </p>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <Button asChild>
                <a href={SIGNUP_URL}>
                  Get started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button asChild variant="outline">
                <Link href="/server">Run your own</Link>
              </Button>
            </div>
          </Feature>

          <Feature
            icon={Bot}
            title="Ask your AI"
            visual={
              <div className="rounded-2xl border bg-card p-6 shadow-xl shadow-black/5">
                <p className="mb-4 text-sm font-medium text-muted-foreground">Things to ask</p>
                <ul className="space-y-3">
                  {prompts.map((prompt) => (
                    <li key={prompt} className="rounded-xl border bg-background px-4 py-3 text-sm leading-relaxed">
                      &ldquo;{prompt}&rdquo;
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-muted-foreground">
                  Answers from your own numbers, not medical advice.
                </p>
              </div>
            }
          >
            <p>
              Add PulsHealth to Claude, sign in and tap Allow. It reads your data and cannot change
              it.
            </p>
            <p>
              It already knows the hard parts: units, your time zone, and steps counted twice by
              iPhone and Watch.
            </p>
            <div className="pt-2">
              <Button asChild variant="outline">
                <Link href="/docs/ai">
                  Connect an assistant
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </Feature>
        </div>
      </section>

      {/* Privacy */}
      <section className="container mx-auto max-w-6xl px-4 py-24">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">Private by design</h2>
          <p className="mx-auto max-w-xl text-lg text-muted-foreground">
            Health data is personal. Here is what that means in practice.
          </p>
        </div>
        <div className="grid gap-10 md:grid-cols-3">
          {privacy.map((item) => (
            <div key={item.title} className="text-center">
              <div className="mx-auto mb-4 w-fit rounded-xl bg-brand-muted p-3 text-brand">
                <item.icon className="h-6 w-6" aria-hidden />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
              <p className="mx-auto max-w-xs text-muted-foreground text-pretty">{item.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-12 text-center text-sm">
          <Link href="/privacy" className={`inline-flex items-center ${textLink}`}>
            Read the privacy policy, with links to the code
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </p>
      </section>

      {/* FAQ */}
      <section className="border-t bg-muted/30">
        <div className="container mx-auto max-w-3xl px-4 py-24">
          <h2 className="mb-8 text-center text-3xl font-bold tracking-tight md:text-4xl">Questions</h2>
          <div className="divide-y rounded-xl border bg-card">
            {homeFaq.map((item) => (
              <details key={item.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {item.q}
                  <span className="font-mono text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-muted-foreground text-pretty">{item.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            More on the{" "}
            <Link href="/support" className="text-brand underline-offset-4 hover:underline">
              support page
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Closing */}
      <section className="border-t">
        <div className="container mx-auto max-w-7xl px-4 py-24">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">Start with the app</h2>
            <p className="mb-8 text-lg text-muted-foreground text-pretty">
              It is free, needs no account, and keeps everything on your phone until you connect a
              database.
            </p>
            <AppStoreBadge />
            <p className="mt-6 text-sm text-muted-foreground">
              Want the database hosted for you?{" "}
              <a href={SIGNUP_URL} className={textLink}>
                Get started
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
