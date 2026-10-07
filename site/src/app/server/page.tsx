import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Code2,
  Database,
  Globe,
  HardDriveDownload,
  LayoutDashboard,
  LineChart,
  Package,
  Plug,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import { DocsNav } from "@/components/docs-nav";
import { docHref } from "@/lib/docs";

/** This page's own href, as `GUIDES` in src/lib/docs.ts lists it. */
const HREF = "/server/";
const SIGNUP_URL = "https://app.pulshealth.com/signup";

export const metadata = {
  title: "Self-hosting - PulsHealth Docs",
  description: "Self-host the open-source PulsHealth database: PostgreSQL 17 with TimescaleDB, a Go ingest API, a read-only product API, Grafana, a web viewer and an MCP server for AI, all via Docker Compose on a machine you own. Free, Apache-2.0.",
  alternates: {
    canonical: HREF,
  },
};

const toc = [
  { id: "setup", text: "Setup" },
  { id: "what-comes-up", text: "What comes up" },
  { id: "how-the-phone-reaches-it", text: "How the phone reaches it" },
  { id: "your-own-backend", text: "Your own backend" },
  { id: "security", text: "Security" },
];

const services = [
  {
    title: "PostgreSQL 17 + TimescaleDB",
    description: "Samples land in hypertables, with columnstore compression on older chunks. Schema migrations are applied by a migrate service before anything else starts, so an upgrade is a pull and a restart.",
    icon: Database,
  },
  {
    title: "Ingest API (Go)",
    description: "The one service designed to face the network. Bearer authentication, gzip NDJSON bodies, inserts that deduplicate by sample UUID, per-IP rate limiting on failed authentications, and structured per-batch logs.",
    icon: Server,
  },
  {
    title: "Product API (Go)",
    description: "Read-only, with an OpenAPI 3.1 document. Deduplicated daily metrics, workouts and their series, activity rings, latest readings, and a streaming export endpoint.",
    icon: Code2,
  },
  {
    title: "Grafana",
    description: "Provisioned dashboards for the health data and for ingest health (batches per hour, rows per day, per-type totals, last-batch age), with alert rules already defined.",
    icon: LineChart,
  },
  {
    title: "Web viewer",
    description: "A Next.js viewer over the same database: activity rings, trends, workouts and the type catalog. Set a password and every page sits behind HTTP Basic; leave it unset and it is an open read-only page.",
    icon: LayoutDashboard,
  },
  {
    title: "MCP server",
    description: "Read-only, talking only to the product API, so Claude, Claude Code or Cursor can answer questions from your data. Run it as a local binary or as a remote connector over HTTPS.",
    icon: Bot,
  },
];

const reach = [
  {
    title: "Same Wi-Fi",
    description: "Bind ingest to the LAN and the pairing block carries a local address; the app accepts plain HTTP for local-network hosts. That is plaintext with the token as the only protection, so use it only on a network you control.",
    icon: Plug,
  },
  {
    title: "From anywhere",
    description: "Put a TLS-terminating proxy or a VPN such as Tailscale in front of the ingest port and hand the script its URL. Ingest stays on loopback and the QR code carries the HTTPS address.",
    icon: Globe,
  },
  {
    title: "Backups are yours",
    description: "A backup service ships with the stack, but it is an opt-in Compose profile and off until you turn it on. Until then the Postgres volume is the only copy of your data.",
    icon: HardDriveDownload,
  },
];

const h2 = "scroll-mt-24 text-2xl font-bold tracking-tight";
const lede = "mt-3 text-muted-foreground leading-relaxed";
const textLink = "inline-flex items-center gap-1 font-medium text-brand underline-offset-4 hover:underline";

export default function SelfHostingPage() {
  return (
    <main className="min-h-screen bg-background pb-20">
      <div className="container mx-auto max-w-7xl px-4 py-10 lg:py-14">
        <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[13.5rem_minmax(0,1fr)_12rem]">
          <aside className="hidden lg:block">
            <div className="custom-scrollbar sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
              <Link
                href="/docs"
                className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                All documentation
              </Link>
              <DocsNav current={HREF} />
            </div>
          </aside>

          <article className="min-w-0 max-w-3xl">
            <details className="mb-8 rounded-lg border bg-muted/30 lg:hidden">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">All docs</summary>
              <div className="border-t px-4 py-4">
                <DocsNav current={HREF} />
              </div>
            </details>

            <header className="mb-10">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">Getting started</p>
              <h1 className="text-4xl font-bold tracking-tight text-balance">Self-hosting</h1>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                Run the open-source database the PulsHealth app syncs to: PostgreSQL with
                TimescaleDB and the services around it, free on a home machine, a NAS or a rented
                box. Your data stays on hardware you control.
              </p>
              <p className="mt-4 rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                Would rather not run it yourself?{" "}
                <a href={SIGNUP_URL} className="font-medium text-brand underline-offset-4 hover:underline">
                  The PulsHealth database
                </a>{" "}
                is the same stack, hosted for you.
              </p>
            </header>

            <section>
              <h2 id="setup" className={h2}>Setup</h2>
              <p className={lede}>
                You need a Linux or macOS box with Docker and its Compose plugin. The bootstrap
                script generates every secret, starts the stack, waits for ingest to answer, and
                prints a pairing block: the URL the phone should use, the bearer token, the user ID,
                and a QR code encoding all three.
              </p>
              <div className="mt-5 overflow-x-auto rounded-lg border bg-muted/40 px-5 py-4">
                <pre className="font-mono text-sm leading-relaxed text-foreground/90">
                  <code>{`git clone https://github.com/PulsHealth/pulshealth.git
cd pulshealth
scripts/bootstrap.sh --time-zone Europe/Berlin`}</code>
                </pre>
              </div>
              <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                <li>
                  Pass the time zone your phone lives in, since every daily view buckets by that
                  calendar. Re-running the script is safe; it never regenerates secrets.
                </li>
                <li>
                  The script pulls the published images from GHCR. Add <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">--build</code> to
                  compile them from the checkout instead, for example to run an unreleased change.
                </li>
              </ul>
              <p className="mt-5 text-sm">
                <Link href={`${docHref("server")}#setup`} className={textLink}>
                  The full setup and operations manual <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </p>
            </section>

            <section className="mt-14">
              <h2 id="what-comes-up" className={h2}>What comes up</h2>
              <p className={lede}>
                Six services plus a one-shot migrator, all in the same repository as the app, all
                yours to inspect and change.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {services.map((service) => (
                  <div key={service.title} className="rounded-xl border bg-card p-5">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="rounded-lg bg-brand-muted p-2 text-brand">
                        <service.icon className="h-4 w-4" aria-hidden />
                      </div>
                      <h3 className="font-semibold">{service.title}</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{service.description}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-14">
              <h2 id="how-the-phone-reaches-it" className={h2}>How the phone reaches it</h2>
              <p className={lede}>
                Everything binds to loopback by default, including ingest, the product API, the MCP
                server, Grafana, the viewer and Postgres. How the phone reaches ingest is up to you.
              </p>
              <div className="mt-6 space-y-4">
                {reach.map((item) => (
                  <div key={item.title} className="flex gap-4">
                    <div className="h-fit rounded-lg border bg-background p-2.5">
                      <item.icon className="h-5 w-5 text-brand" aria-hidden />
                    </div>
                    <div>
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-14">
              <h2 id="your-own-backend" className={h2}>Your own backend</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col rounded-xl border bg-card p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="rounded-lg bg-brand-muted p-2 text-brand">
                      <Terminal className="h-4 w-4" aria-hidden />
                    </div>
                    <h3 className="font-semibold">Write a receiver</h3>
                  </div>
                  <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                    This stack is one receiver, not the only one. A receiver has to accept the
                    batch, deduplicate samples by UUID, upsert aggregate buckets and activity
                    summaries, and return 2xx. All of that is specified in the Puls Sync Protocol
                    v1, with a JSON Schema per line type, a fixture corpus, a batch checker, and a
                    complete receiver in one standard-library Python file writing to SQLite.
                  </p>
                  <Link href={docHref("protocol")} className={`mt-4 text-sm ${textLink}`}>
                    Read the specification <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <div className="flex flex-col rounded-xl border bg-card p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="rounded-lg bg-brand-muted p-2 text-brand">
                      <Package className="h-4 w-4" aria-hidden />
                    </div>
                    <h3 className="font-semibold">Embed the sync engine</h3>
                  </div>
                  <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                    PulsHealthSync, the Swift package underneath the app, is usable on its own: iOS
                    17+, Swift 6 strict concurrency, zero third-party dependencies. Anchored-query
                    sync, on-device aggregates, activity rings, background scheduling, the HTTP
                    transport and the NDJSON encoding, without the UI.
                  </p>
                  <Link href={docHref("swift-package")} className={`mt-4 text-sm ${textLink}`}>
                    Read the package docs <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </section>

            <section className="mt-14">
              <h2 id="security" className={`${h2} flex items-center gap-2`}>
                <ShieldCheck className="h-6 w-6 text-brand" aria-hidden />
                Security is your job too
              </h2>
              <p className={lede}>
                The database holds identifiable health data. Each phone can have its own bearer
                token, bound to one user, stored only as a hash and revocable on its own. The shared
                token a new install starts with still works until you switch it off, and anyone who
                has that one can upload and delete for any user in the database. TLS, network
                exposure and retention are yours to set up. The security policy lists the known
                limitations.
              </p>
              <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <Link href={docHref("security")} className={textLink}>
                  Security policy <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link href="/privacy" className={textLink}>
                  Privacy policy <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </p>
            </section>
          </article>

          <aside className="hidden xl:block">
            <nav
              aria-label="On this page"
              className="custom-scrollbar sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto border-l pl-4 text-sm"
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this page</p>
              <ul className="space-y-1.5">
                {toc.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      className="block leading-snug text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {entry.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        </div>
      </div>
    </main>
  );
}
