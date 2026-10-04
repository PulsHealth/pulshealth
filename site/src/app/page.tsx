import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Bot,
  Check,
  Cloud,
  Database,
  FileCode2,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  Minus,
  PenLine,
  Server,
  Smartphone,
  Star,
} from "lucide-react";
import { GitHubIcon } from "@/components/brand-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppStoreBadge, APP_STORE_URL } from "@/components/app-store-badge";
import { FollowProject } from "@/components/follow-project";
import { getAllTypes } from "@/lib/api";
import { getCatalog } from "@/lib/catalog";
import { faq } from "@/lib/faq";
import { GITHUB_URL, formatStars, getRepoStats } from "@/lib/github";

const BLOB = `${GITHUB_URL}/blob/main`;

/** The hosted database's sign-up page, on the viewer's origin. */
const SIGNUP_URL = "https://app.pulshealth.com/signup";

type Way = {
  key: string;
  name: string;
  tagline: string;
  price: string;
  icon: typeof Smartphone;
  where: string;
  points: string[];
  cta: { label: string; href: string; external?: boolean };
  featured?: boolean;
};

const ways: Way[] = [
  {
    key: "app",
    name: "The app",
    tagline: "Explore and export, on the phone.",
    price: "Free",
    icon: Smartphone,
    where: "On your iPhone, until you share an export.",
    points: [
      "Every Apple Health type, with a year of analysis per type",
      "CSV or JSONL export for any types and dates",
      "No account, no database, no network",
    ],
    cta: { label: "Download on the App Store", href: APP_STORE_URL, external: true },
  },
  {
    key: "hosted",
    name: "The PulsHealth database",
    tagline: "We run the database for you.",
    price: "The one paid part",
    icon: Cloud,
    where: "On our database, under your own account.",
    points: [
      "Connect the app to your account and your history syncs, then keeps up",
      "The web viewer at app.pulshealth.com",
      "Connect Claude: sign in and tap Allow",
      "Nothing to install or keep updated",
    ],
    cta: { label: "Get started", href: SIGNUP_URL, external: true },
    featured: true,
  },
  {
    key: "self",
    name: "Your own database",
    tagline: "Run the open-source stack yourself.",
    price: "Free",
    icon: Server,
    where: "On a machine you control.",
    points: [
      "PostgreSQL with TimescaleDB, Grafana, the viewer, the API and the MCP server",
      "One script on any Docker host, and a QR code to pair",
      "Or write a receiver for the documented protocol",
    ],
    cta: { label: "Set up your database", href: "/server" },
  },
];

const prompts = [
  "Plan the next 16 weeks of marathon training from my last three months of runs, my heart rate and my HRV.",
  "Write my weekly report: training load, sleep and resting heart rate, against the month before.",
  "How does my sleep change in the days after a hard training week?",
  "Where have my runs got faster this year, and what else changed around then?",
];

const pieces = [
  {
    title: "iOS app",
    href: "/ios",
    icon: Smartphone,
    description: "Reads Apple Health read-only. Explore and export it on the phone, or stream every sample to a database: full backfill first, then background sync. Workouts with GPS, activity rings.",
  },
  {
    title: "PostgreSQL + TimescaleDB",
    href: "/server",
    icon: Database,
    description: "Samples land in hypertables with compression on older chunks. Migrations run automatically on every start. Hosted for you, or on your own Docker host.",
  },
  {
    title: "Grafana and a web viewer",
    href: "/server",
    icon: LayoutDashboard,
    description: "A Next.js viewer over the same database: rings, trends, workouts. Self-hosted, it adds provisioned Grafana dashboards and an optional password; hosted, it is your account at app.pulshealth.com.",
  },
  {
    title: "MCP server for AI",
    href: "/docs/ai",
    icon: Bot,
    description: "Read-only, over the product API, so Claude, Claude Code or Cursor can answer from your daily metrics, rings, workouts and sleep. It ships a guide that tells the model about units and double counting.",
  },
  {
    title: "Open wire protocol",
    href: "/docs/protocol",
    icon: FileCode2,
    description: "Gzip NDJSON over HTTPS, a JSON Schema per line type, canonical units, a fixture corpus and a Python reference receiver. Or write your own backend.",
  },
  {
    title: "CSV and JSONL export",
    href: "/docs/export",
    icon: FileSpreadsheet,
    description: "From the app with no database at all, or streamed out of the product API with a small CLI. The quickest route to a spreadsheet or a notebook.",
  },
];

const claims = [
  {
    title: "The app alone sends nothing",
    body: "Exploring and exporting need no account and make no network request. An export goes wherever you send it from the share sheet.",
    check: { label: "Export/", href: `${GITHUB_URL}/tree/main/PulsHealthSync/Sources/PulsHealthSync/Export` },
  },
  {
    title: "Your database, or ours: your choice",
    body: "The app uploads only to the database you set up. Run your own and the developer never sees your data. Choose the PulsHealth database and we hold it under your account, to show it back to you and to the assistants you connect. It is never sold or shared, and deleting your account deletes it.",
    check: { label: "Transport/", href: `${GITHUB_URL}/tree/main/PulsHealthSync/Sources/PulsHealthSync/Transport` },
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

type Cell = boolean | string;
const comparison: { name: string; href?: string; cells: Cell[] }[] = [
  { name: "PulsHealth", cells: [true, true, "Apache-2.0", "Hosted for you, or your Postgres", true, true, "Free app; hosting paid"] },
  { name: "Health Auto Export", href: "https://www.healthyapps.dev/", cells: [false, "Community receivers", "Closed", "Your endpoint, Drive, MQTT…", "Community-documented", false, "Subscription"] },
  { name: "HealthSave", href: "https://healthsave.app/", cells: [false, "Source-available", "Elastic 2.0", "Your TimescaleDB", false, false, "One-time"] },
  { name: "FreeReps", href: "https://freereps.meltforce.org/", cells: [true, true, "MIT", "Your server (Tailscale)", false, true, "Free"] },
  { name: "Apple's export", cells: [false, false, "—", "A zip of XML", false, false, "Free"] },
];
const comparisonColumns = ["Open-source app", "Open-source backend", "License", "Where data lives", "Wire format specified", "AI assistant access", "Price"];

/** Knowledge-base pages shown as examples, in this order. */
const kbExamples = [
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierVO2Max",
  "HKCategoryTypeIdentifierSleepAnalysis",
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-brand" aria-label="Yes" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-muted-foreground/60" aria-label="No" />;
  return <span className="text-muted-foreground">{value}</span>;
}

function WayCta({ cta, featured }: { cta: Way["cta"]; featured?: boolean }) {
  const content = (
    <>
      {cta.label}
      <ArrowRight className="ml-2 h-4 w-4" />
    </>
  );
  return (
    <Button asChild variant={featured ? "default" : "outline"} className="w-full">
      {cta.external ? (
        <a href={cta.href} target={cta.href === APP_STORE_URL ? "_blank" : undefined} rel="noopener noreferrer">
          {content}
        </a>
      ) : (
        <Link href={cta.href}>{content}</Link>
      )}
    </Button>
  );
}

export default async function HomePage() {
  const { stars } = await getRepoStats();
  const starLabel = formatStars(stars);
  const homeFaq = faq.filter((f) => f.home);
  const syncedTypeCount = getCatalog().types.length;
  const kbTypes = await getAllTypes();
  const kbCount = kbTypes.length;
  const kbFeatured = kbExamples
    .map((id) => kbTypes.find((t) => t.identifier === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero */}
      <section className="w-full border-b bg-gradient-to-b from-background to-muted/40 pt-20 pb-16">
        <div className="container mx-auto flex max-w-7xl flex-col items-center space-y-6 px-4 text-center">
          <Badge variant="outline" className="rounded-full bg-background/60 px-4 py-1 text-sm backdrop-blur-sm">
            Free app &middot; Open source &middot; Apache-2.0
          </Badge>

          <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-foreground text-balance md:text-6xl">
            Your Apple Health data, ready for <span className="text-brand">you and your AI</span>.
          </h1>

          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty md:text-xl">
            A free, open-source iPhone app to explore and export everything in Apple Health. Sync
            it to a database, hosted for you or run by you, and give Claude your whole health
            history to work from.
          </p>

          <div className="flex flex-col items-center gap-4 pt-2 sm:flex-row">
            <AppStoreBadge />
            <Button asChild size="lg">
              <a href={SIGNUP_URL}>
                <Cloud className="mr-2 h-4 w-4" />
                Get started
              </a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Prefer to run it yourself?{" "}
            <Link href="/server" className="text-brand underline-offset-4 hover:underline">
              Self-host the database
            </Link>
            .
          </p>

          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-2 text-sm text-muted-foreground">
            <li>No account needed for the app</li>
            <li>No telemetry</li>
            <li>Read-only HealthKit access</li>
            <li>Zero dependencies in the app</li>
            <li>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                <Star className="h-3.5 w-3.5" aria-hidden />
                {starLabel ? `${starLabel} on GitHub` : "Source on GitHub"}
              </a>
            </li>
          </ul>
        </div>

        {/* Product shot */}
        <div className="container mx-auto mt-14 max-w-6xl px-4">
          <figure className="overflow-hidden rounded-xl border bg-[#0b0b0c] shadow-2xl shadow-black/20">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="ml-3 truncate font-mono text-[11px] text-white/40">https://health.example.net</span>
            </div>
            <Image
              src="/screenshots/viewer-today.webp"
              alt="The PulsHealth web viewer showing today's activity rings, highlight tiles for steps, energy, resting heart rate, sleep, HRV, distance, VO2 max and body weight, and recent workouts."
              width={1440}
              height={900}
              priority
              className="w-full"
            />
            <figcaption className="border-t border-white/10 px-4 py-2 text-xs text-white/50">
              The web viewer, which comes with either database, against demo data.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Three ways */}
      <section id="ways" className="container mx-auto max-w-7xl scroll-mt-16 px-4 py-24">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight">Three ways to use it</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Start with the app. Add a database when you want your data somewhere you can query,
            chart and hand to an AI. The same app syncs to either one.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {ways.map((way) => (
            <Card
              key={way.key}
              className={`flex h-full min-w-0 flex-col ${way.featured ? "border-brand/50 shadow-lg shadow-brand/5 ring-1 ring-brand/20" : ""}`}
            >
              <CardHeader>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="w-fit rounded-xl bg-brand-muted p-3 text-brand">
                    <way.icon className="h-6 w-6" />
                  </div>
                  <Badge variant={way.featured ? "default" : "secondary"} className="font-normal">
                    {way.price}
                  </Badge>
                </div>
                <CardTitle className="text-xl">{way.name}</CardTitle>
                <CardDescription className="text-base">{way.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <ul className="mb-5 space-y-2.5 text-sm">
                  {way.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                      <span className="text-muted-foreground">{point}</span>
                    </li>
                  ))}
                </ul>
                {way.key === "self" && (
                  <div className="mb-5 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2.5">
                    <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
                      <code>{`git clone https://github.com/PulsHealth/pulshealth.git
cd pulshealth
scripts/bootstrap.sh --time-zone Europe/Berlin`}</code>
                    </pre>
                  </div>
                )}
                <p className="mb-5 mt-auto border-t pt-4 text-sm">
                  <span className="font-medium text-foreground">Where your data lives: </span>
                  <span className="text-muted-foreground">{way.where}</span>
                </p>
                <WayCta cta={way.cta} featured={way.featured} />
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
          Everything except hosting is free, and the app has no in-app purchases. Both
          databases run the same open-source code.
        </p>
      </section>

      {/* AI */}
      <section className="border-y bg-muted/30">
        <div className="container mx-auto max-w-7xl px-4 py-24">
          <div className="mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-2">
            <div>
              <Badge variant="outline" className="mb-4">MCP &middot; Claude</Badge>
              <h2 className="mb-4 text-3xl font-bold tracking-tight">Give Claude your health context</h2>
              <p className="mb-6 text-lg text-muted-foreground">
                PulsHealth ships a read-only MCP server, so an assistant can work from your actual
                runs, heart rate, HRV, sleep, workouts and rings instead of what you remember to
                tell it.
              </p>
              <ul className="space-y-4 text-muted-foreground">
                <li className="flex items-start gap-3">
                  <Cloud className="mt-1 h-5 w-5 shrink-0 text-brand" />
                  <span>
                    <strong className="text-foreground">On the PulsHealth database</strong>, add
                    it as a connector in the Claude app (iPhone, Android, desktop or claude.ai) or
                    in Claude Code, sign in and tap Allow. Nothing to install.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Server className="mt-1 h-5 w-5 shrink-0 text-brand" />
                  <span>
                    <strong className="text-foreground">On your own database</strong>, run the
                    MCP server locally or as a remote connector for Claude, Claude Code, Cursor or
                    any other MCP client.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Lock className="mt-1 h-5 w-5 shrink-0 text-brand" />
                  <span>
                    It can read, never write. Its built-in guide tells the model about units, your
                    time zone and iPhone-plus-Watch double counting, so the numbers come out right.
                  </span>
                </li>
              </ul>
              <div className="mt-8">
                <Button asChild>
                  <Link href="/docs/ai">
                    <Bot className="mr-2 h-4 w-4" />
                    Connect an assistant
                  </Link>
                </Button>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-6">
              <p className="mb-4 text-sm font-medium text-muted-foreground">Things to ask</p>
              <ul className="space-y-3">
                {prompts.map((prompt) => (
                  <li key={prompt} className="rounded-lg border bg-background px-4 py-3 text-sm leading-relaxed text-foreground">
                    &ldquo;{prompt}&rdquo;
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Feedback grounded in your own numbers, not medical advice. What the assistant reads
                goes to its provider under that provider&apos;s terms.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Knowledge base */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Badge variant="outline" className="mb-4">Knowledge base</Badge>
            <h2 className="mb-4 text-3xl font-bold tracking-tight">Know what the numbers mean</h2>
            <p className="mb-4 text-lg text-muted-foreground">
              All {kbCount} Apple Health types, explained: what each one measures, how the Watch,
              the iPhone and third-party devices collect it, how often, typical ranges with
              sources, and where the number stops being reliable.
            </p>
            <p className="mb-6 text-muted-foreground">
              Two HRV readings from different devices are not the same measurement, and a sum of
              iPhone and Watch steps counts twice. Knowing that matters to you, and to any AI
              reading your data. The app uses it too: each type&apos;s page shows its description and
              typical range.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild>
                <Link href="/knowledge-base">
                  <BookOpen className="mr-2 h-4 w-4" />
                  Browse the knowledge base
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/blog">
                  <PenLine className="mr-2 h-4 w-4" />
                  Read the blog
                </Link>
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {kbFeatured.map((t) => (
              <Link key={t.identifier} href={`/knowledge-base/types/${t.identifier}`} className="group block">
                <Card className="transition-all duration-200 hover:border-brand/40 hover:shadow-lg">
                  <CardHeader>
                    <div className="flex items-baseline justify-between gap-3">
                      <CardTitle className="text-lg transition-colors group-hover:text-brand">
                        {t.human_readable_name}
                      </CardTitle>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {t.devices.length} device notes
                      </span>
                    </div>
                    <CardDescription className="line-clamp-3 text-sm">{t.short_description}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* What is in the box */}
      <section className="border-y bg-muted/30">
        <div className="container mx-auto max-w-7xl px-4 py-24">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight">What is included</h2>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              All of it is in one Apache-2.0 repository: the app syncs {syncedTypeCount} HealthKit
              types, and every piece below is yours to run. The PulsHealth database runs the same
              code.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {pieces.map((piece) => (
              <Link key={piece.title} href={piece.href} className="group">
                <Card className="h-full transition-all duration-200 hover:border-brand/40 hover:shadow-lg">
                  <CardHeader>
                    <div className="mb-4 w-fit rounded-xl bg-brand-muted p-3 text-brand">
                      <piece.icon className="h-6 w-6" />
                    </div>
                    <CardTitle className="text-xl transition-colors group-hover:text-brand">
                      {piece.title}
                    </CardTitle>
                    <CardDescription className="text-base">{piece.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <span className="inline-flex items-center text-sm font-medium text-brand">
                      Learn more <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <figure className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-xl border bg-[#0b0b0c] shadow-xl shadow-black/10">
            <Image
              src="/screenshots/viewer-workouts.webp"
              alt="The web viewer's workouts page: session count, total time, energy and distance, then a list of workouts with duration, calories and distance."
              width={1440}
              height={900}
              className="w-full"
            />
            <figcaption className="border-t border-white/10 px-4 py-2 text-xs text-white/50">
              Workouts in the web viewer. On your own stack, Grafana dashboards cover the same data and ingest health.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Privacy: checkable claims */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight">Privacy, with the code to show for it</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Health data is personal. Each claim below links to the code behind it, and the{" "}
            <Link href="/privacy" className="text-brand underline-offset-4 hover:underline">
              privacy policy
            </Link>{" "}
            has the details.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {claims.map((claim) => (
            <div key={claim.title} className="flex flex-col rounded-xl border bg-card p-6">
              <div className="mb-4 w-fit rounded-xl bg-brand-muted p-3 text-brand">
                <Lock className="h-6 w-6" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{claim.title}</h3>
              <p className="mb-4 flex-1 text-muted-foreground">{claim.body}</p>
              <a
                href={claim.check.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-xs text-brand hover:underline"
              >
                <GitHubIcon className="h-3.5 w-3.5" />
                check: {claim.check.label}
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section className="border-y bg-muted/30">
        <div className="container mx-auto max-w-7xl px-4 py-24">
          <div className="mb-10 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight">Compared with the alternatives</h2>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Other ways to get Apple Health out of the phone, and where they differ.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-4 py-3 font-semibold">&nbsp;</th>
                  {comparisonColumns.map((col) => (
                    <th key={col} className="px-4 py-3 text-center font-semibold">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.name} className={`border-b last:border-0 ${row.name === "PulsHealth" ? "bg-brand-muted/40" : ""}`}>
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      {row.href ? (
                        <a href={row.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {row.name}
                        </a>
                      ) : (
                        row.name
                      )}
                    </th>
                    {row.cells.map((cell, i) => (
                      <td key={i} className="px-4 py-3 text-center">
                        <CellValue value={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Checked in September 2026 against each project&apos;s public site. If something here is
            out of date,{" "}
            <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
              open an issue
            </a>{" "}
            and it will be corrected.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <div className="container mx-auto max-w-3xl px-4 py-24">
          <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">Common questions</h2>
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
            , including the iOS behaviours that look like bugs.
          </p>
        </div>
      </section>

      {/* Consulting */}
      <section className="border-t bg-muted/30">
        <div className="container mx-auto max-w-7xl px-4 py-24">
          <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[1.2fr_1fr]">
            <div>
              <Badge variant="outline" className="mb-4">Consulting</Badge>
              <h2 className="mb-4 text-3xl font-bold tracking-tight">Consulting</h2>
              <p className="text-lg text-muted-foreground">
                The app, the stack and the documentation are free. If you want help setting up
                the stack, connecting your data to AI tools, implementing the protocol against
                your own backend, or building on the data, I do that work.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/consulting">
                    <Briefcase className="mr-2 h-4 w-4" />
                    Consulting
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="mailto:support@pulshealth.com">Email the maintainer</a>
                </Button>
              </div>
            </div>
            <ul className="space-y-3 rounded-xl border bg-card p-6 text-sm">
              {[
                "Get the self-hosted stack running, and keep it running",
                "Wire your health data into Claude, Cursor or ChatGPT",
                "Implement or review a Puls Sync Protocol receiver",
                "Dashboards, exports and analysis on your own data",
                "Health-data engineering beyond this project",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <FollowProject />
    </main>
  );
}
