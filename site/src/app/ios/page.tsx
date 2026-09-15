import Link from "next/link";
import dynamic from "next/dynamic";
import { Activity, ArrowRight, BarChart3, Bot, Database, Dumbbell, Ear, FileJson, FileSpreadsheet, Footprints, Gauge, Github, Heart, History, Lock, Mail, Moon, QrCode, RefreshCw, Scale, Server, Terminal, Utensils, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppStoreBadge } from "@/components/app-store-badge";
import { getCatalog, getCatalogByGroup } from "@/lib/catalog";

const UpdatesDialog = dynamic(
  () => import("@/components/updates-dialog").then((mod) => mod.UpdatesDialog),
);

const GITHUB = "https://github.com/PulsHealth/pulshealth";

export const metadata = {
  title: "PulsHealth for iOS - Apple Health, Synced to Your Own Server",
  description: "A free, open-source iOS app that reads Apple Health read-only and streams every sample to a backend you run yourself. Full historical backfill, then continuous near-real-time sync. On the App Store, Apache-2.0.",
  alternates: {
    canonical: '/ios/',
  },
};

const syncFeatures = [
  {
    title: "Full History First",
    description: "The initial backfill exports everything from the start date you choose, four types at a time, with live per-type progress, rate and ETA. It saves its place after every batch, so interrupting it costs nothing.",
    icon: History,
  },
  {
    title: "Then It Keeps Up",
    description: "A HealthKit observer plus background delivery drains new samples — and deletions — as iOS allows. A background processing task catches up when the phone is idle, and every time you open the app it runs a full pass.",
    icon: RefreshCw,
  },
  {
    title: "Read-Only, Always",
    description: "The app asks Apple Health for read permission and nothing else. It never writes, edits or deletes anything in HealthKit, and the usage strings say so.",
    icon: Lock,
  },
  {
    title: "Pair by Scanning",
    description: "Your server prints a pairing block — URL, bearer token and user ID — with a QR code encoding all three. Scan it, or type the three values in by hand.",
    icon: QrCode,
  },
  {
    title: "Aggregates and Rings",
    description: "Any quantity type can also be sent as on-device buckets — hourly sums, daily averages, optionally split by Watch versus iPhone — and daily activity rings arrive as one upserted row per day.",
    icon: BarChart3,
  },
  {
    title: "Nothing Hidden",
    description: "A live event log, per-type progress, and a record of every background wake iOS granted. All of it exports for offline analysis, and a built-in benchmark tells you how fast your phone can read.",
    icon: Activity,
  },
];

const groupIcons: Record<string, typeof Activity> = {
  activity: Footprints,
  heart: Heart,
  body: Scale,
  respiratory: Wind,
  sleep: Moon,
  nutrition: Utensils,
  vitals: Activity,
  workouts: Dumbbell,
  other: Ear,
};

const catalogGroups = getCatalogByGroup();
const catalogTypeCount = getCatalog().types.length;

const outputs = [
  {
    title: "SQL and Grafana",
    badge: "postgres",
    description: "Data lands in PostgreSQL 17 with TimescaleDB. Query it directly, or use the provisioned Grafana dashboards and the web viewer that ship with the stack.",
    icon: Database,
  },
  {
    title: "CSV and JSONL",
    badge: "/v1/export",
    description: "The product API streams any dataset as CSV or JSONL, and puls-export is a small CLI wrapper for it. For a spreadsheet or a notebook, that is the shortest path.",
    icon: FileSpreadsheet,
  },
  {
    title: "AI Assistants",
    badge: "mcp",
    description: "A read-only MCP server lets Claude, Claude Code or Cursor answer questions from your data. ChatGPT connects through the API's OpenAPI document instead.",
    icon: Bot,
  },
];

export default function AppPage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="w-full bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900 pt-20 pb-32 border-b">
        <div className="container mx-auto max-w-7xl px-4 flex flex-col items-center text-center space-y-8">
          <Badge variant="outline" className="px-4 py-1 text-sm rounded-full border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
            Free on the App Store &middot; Open source
          </Badge>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 max-w-3xl">
            Apple Health,{" "}
            <span className="text-brand">in your own database</span>
          </h1>

          <p className="text-lg md:text-xl text-zinc-500 max-w-2xl leading-relaxed">
            PulsHealth for iOS reads Apple Health — read-only, it never writes back — and streams
            every sample to a server you run. Full history first, then it keeps up on its own.
            There is no PulsHealth account and no PulsHealth cloud.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
            <AppStoreBadge />
            <Button asChild size="lg" variant="outline">
              <a href={GITHUB} target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-4 w-4" />
                Get the Source
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="#features">
                How It Works
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Honest status */}
      <section className="container mx-auto max-w-7xl px-4 py-16">
        <Card className="max-w-3xl mx-auto border-brand/30">
          <CardHeader>
            <CardTitle>Before You Start</CardTitle>
            <CardDescription className="text-base">
              Three things are worth knowing up front, because none of them is the usual
              arrangement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4 text-muted-foreground">
              <li>
                <strong className="text-foreground">It is on the App Store.</strong> Free, for
                iPhone. You can also build it yourself with Xcode 26 and XcodeGen — but running
                your own build on a real iPhone needs a paid Apple Developer team, because the
                HealthKit background-delivery entitlement requires one.
              </li>
              <li>
                <strong className="text-foreground">You need a server first.</strong> The app has
                nowhere to sync until a backend exists. The reference stack comes up with one
                command; anything that speaks the documented protocol works just as well.
              </li>
              <li>
                <strong className="text-foreground">Both halves are open source.</strong> The app,
                the sync library, the server stack, the protocol and the dashboards are all in one
                Apache-2.0 repository, so every claim on this page is checkable against the code.
              </li>
            </ul>
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Button asChild variant="outline">
                <Link href="/server">
                  <Server className="mr-2 h-4 w-4" />
                  Set Up the Server
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href={`${GITHUB}#app`} target="_blank" rel="noopener noreferrer">
                  <Terminal className="mr-2 h-4 w-4" />
                  Build Instructions
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Sync Features Section */}
      <section id="features" className="container mx-auto max-w-7xl px-4 pb-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">How the Sync Works</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Each HealthKit type has its own cursor, persisted only after your server confirms the
            batch. A failed upload re-sends the same page, and the server deduplicates by sample
            UUID — so the pipeline is idempotent end to end.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {syncFeatures.map((feature) => (
            <Card key={feature.title} className="h-full">
              <CardHeader>
                <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mb-4">
                  <feature.icon className="h-6 w-6" />
                </div>
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription className="text-base">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* Stats Section */}
      <section className="bg-muted/30 border-y">
        <div className="container mx-auto max-w-7xl px-4 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-4xl font-bold text-brand mb-2">80</div>
              <div className="text-muted-foreground">HealthKit types it can sync</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-brand mb-2">0</div>
              <div className="text-muted-foreground">Third-party dependencies</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-brand mb-2">0</div>
              <div className="text-muted-foreground">Accounts, servers or trackers run by the developer</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-brand mb-2">iOS 17+</div>
              <div className="text-muted-foreground">Free on the App Store</div>
            </div>
          </div>
        </div>
      </section>

      {/* Data Types Section */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">What You Can Sync</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            80 HealthKit types, grouped the way Apple Health groups them. Turn on a starter
            set in one tap, or choose type by type — nothing is read until you enable it and iOS
            grants permission.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {catalogGroups.map(({ group, types }) => {
            const Icon = groupIcons[group.key] ?? Activity;
            return (
              <div key={group.key} className="flex items-center justify-between gap-3 p-4 rounded-lg border bg-card">
                <span className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-brand" />
                  <span className="font-medium text-sm">{group.label}</span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">{types.length}</span>
              </div>
            );
          })}
        </div>

        <details className="group mt-8 mx-auto max-w-4xl rounded-lg border bg-card">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium flex items-center justify-between">
            <span>Every type, by name</span>
            <span className="font-mono text-xs text-muted-foreground group-open:hidden">show {catalogTypeCount}</span>
            <span className="font-mono text-xs text-muted-foreground hidden group-open:inline">hide</span>
          </summary>
          <div className="border-t px-5 py-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {catalogGroups.map(({ group, types }) => (
              <div key={group.key}>
                <h3 className="text-sm font-semibold mb-2">{group.label}</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {types.map((t) => (
                    <li key={t.identifier} className="flex items-baseline justify-between gap-2">
                      <span>{t.displayName}</span>
                      {t.unit && <span className="font-mono text-xs opacity-70">{t.unit}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            Rendered at build time from the protocol&apos;s published vocabulary,{" "}
            <a href={`${GITHUB}/blob/main/docs/protocol/catalog.json`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
              catalog.json
            </a>
            . Units are the canonical ones every sample is converted to before upload.
          </p>
        </details>

        <p className="text-center text-muted-foreground mt-8 max-w-2xl mx-auto">
          Workouts carry their GPS routes and per-second sensor series; ECGs bring their microvolt
          trace; State of Mind, sleep apnea events and medication doses come across on the iOS
          versions that support them.
        </p>

        <div className="text-center mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild variant="outline">
            <Link href="/knowledge-base">
              What each type measures
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Wire Format Section */}
      <section className="bg-muted/30 border-y">
        <div className="container mx-auto max-w-7xl px-4 py-24">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <Badge variant="outline" className="mb-4">Open Protocol</Badge>
              <h2 className="text-3xl font-bold tracking-tight mb-4">
                One URL, one documented format
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                The app posts gzip-compressed NDJSON over HTTPS to the address you enter, with a
                bearer token you also choose. That is its only network destination. The format is
                specified — not merely implemented — so the reference stack is one possible receiver
                rather than the only one.
              </p>

              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="p-2 rounded-lg bg-brand-muted text-brand h-fit">
                    <FileJson className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Puls Sync Protocol v1</h4>
                    <p className="text-muted-foreground text-sm">A JSON Schema for every line type, canonical units for every quantity, epoch-millisecond timestamps, and the retry and idempotency rules a receiver can rely on.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="p-2 rounded-lg bg-brand-muted text-brand h-fit">
                    <Terminal className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Write Your Own Backend</h4>
                    <p className="text-muted-foreground text-sm">A fixture corpus, a batch checker, and a complete receiver in one standard-library Python file writing to SQLite — copy it, or read it alongside the spec.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="p-2 rounded-lg bg-brand-muted text-brand h-fit">
                    <Gauge className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Measured, Not Guessed</h4>
                    <p className="text-muted-foreground text-sm">Device-side HealthKit reads are the bottleneck, not the network. The in-app throughput benchmark reads real data through a discarding transport so you can size a backfill before you start one.</p>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <Button asChild variant="outline">
                  <a href={`${GITHUB}/tree/main/docs/protocol`} target="_blank" rel="noopener noreferrer">
                    Read the Specification
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border bg-background p-5">
              <pre className="text-xs md:text-sm font-mono leading-relaxed text-muted-foreground">
                <code>{`POST https://health.example.net/v1/batches
Authorization: Bearer <your token>
Content-Encoding: gzip
X-User-ID: <your user id>

{"batchID":"...","quantityCount":2,...}
{"uuid":"...","type":"HKQuantityType...
{"uuid":"...","type":"HKQuantityType...

→ 200 OK   (only now does the phone
            advance its cursor)`}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Outputs Section */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Once It Is Yours</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            The point of moving the data is being able to use it. Nothing here is a separate
            product — it all ships in the same repository.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {outputs.map((output) => (
            <Card key={output.title} className="h-full text-center">
              <CardHeader>
                <Badge variant="secondary" className="w-fit mx-auto mb-4 font-mono">
                  {output.badge}
                </Badge>
                <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mx-auto mb-4">
                  <output.icon className="h-6 w-6" />
                </div>
                <CardTitle>{output.title}</CardTitle>
                <CardDescription className="text-base">
                  {output.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* Stay Updated */}
      <section className="bg-muted/30 border-y">
        <div className="container mx-auto max-w-7xl px-4 py-16">
          <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
            <div className="p-3 rounded-xl bg-brand-muted text-brand">
              <Mail className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Follow the project</h2>
            <p className="text-muted-foreground">
              An occasional email when there is a release, news about the app, or a change
              to the sync protocol or the server stack. Your name and address, nothing more.
            </p>
            <UpdatesDialog>
              <Button variant="outline">
                Sign Up for Updates
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </UpdatesDialog>
          </div>
        </div>
      </section>

      {/* Requirements + CTA Section */}
      <section className="cta-gradient text-white">
        <div className="container mx-auto max-w-7xl px-4 py-24 text-center">
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Install it, then point it at your server
          </h2>
          <p className="text-lg opacity-90 max-w-2xl mx-auto mb-8">
            An iPhone on iOS 17 or later and a server you can reach. Apple Watch data arrives once
            iOS syncs it to the phone. Prefer to build it yourself? The repository has the Xcode
            instructions.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
            <AppStoreBadge />
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white dark:bg-transparent dark:border-white/40 dark:hover:bg-white/10"
            >
              <Link href="/server">
                <Server className="mr-2 h-4 w-4" />
                Set Up the Server
              </Link>
            </Button>
          </div>
          <p className="mt-8 text-sm opacity-75 max-w-2xl mx-auto">
            PulsHealth moves data; it is not a medical device and gives no medical advice. Accuracy
            is that of whatever recorded the sample into Apple Health. The name and logo are the
            developer&apos;s; the code is Apache-2.0, so a fork ships under its own name.
          </p>
        </div>
      </section>
    </main>
  );
}
