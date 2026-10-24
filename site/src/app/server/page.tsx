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
  title: "Self-hosting overview - PulsHealth",
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
    description: "Stores your health records. TimescaleDB organizes time-series data and compresses older records. A migration service prepares the schema.",
    icon: Database,
  },
  {
    title: "Ingest API (Go)",
    description: "Receives authenticated uploads from your phone. Repeated uploads of the same sample are safe.",
    icon: Server,
  },
  {
    title: "Product API (Go)",
    description: "Serves daily metrics, workouts, activity rings and exports to your own projects through a documented read-only API.",
    icon: Code2,
  },
  {
    title: "Grafana",
    description: "Includes health-data dashboards and server monitoring, with alert rules you can configure.",
    icon: LineChart,
  },
  {
    title: "Web viewer",
    description: "Browse activity rings, trends, workouts and individual types. Fresh bootstrap installs generate a login password.",
    icon: LayoutDashboard,
  },
  {
    title: "MCP server",
    description: "Lets compatible AI assistants read your data through the product API. Connecting an assistant is optional and requires separate configuration.",
    icon: Bot,
  },
];

const reach = [
  {
    title: "Same Wi-Fi",
    description: "The LAN option lets your phone sync on trusted home Wi-Fi. It uses unencrypted HTTP, so it belongs only on a network you control.",
    icon: Plug,
  },
  {
    title: "From anywhere",
    description: "Use an HTTPS proxy, optionally over a private VPN. The setup guide explains how to give the phone a reachable URL while keeping the other services private.",
    icon: Globe,
  },
  {
    title: "Backups are yours",
    description: "Backups are optional and start only when enabled. Keep a separate copy and test restoration; the database volume alone is not a backup.",
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
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">Self-hosting overview</p>
              <h1 className="text-4xl font-bold tracking-tight text-balance">Self-hosting</h1>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                Keep a copy of your Apple Health data in a database you manage, with a dashboard,
                exports and an API. The open-source stack runs with Docker Compose on Linux or
                macOS. You manage the machine, access, updates and backups.
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
                Follow one guide from choosing a network connection to seeing your first synced
                records. It includes a copyable prompt for an AI coding assistant, the installation
                commands, iPhone pairing and troubleshooting. The backend is pre-release software.
              </p>
              <p className="mt-5 text-sm">
                <Link href={docHref("setup")} className={textLink}>
                  Set up your server <ArrowRight className="h-3.5 w-3.5" />
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
                    The app also syncs to compatible receivers you build. The protocol specifies
                    uploads, authentication and acknowledgments, with schemas, test fixtures and
                    a complete Python/SQLite example.
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
                    Add HealthKit sync to your own iOS app with PulsHealthSync, the Swift package
                    underneath PulsHealth. It includes queries, aggregation, background scheduling
                    and upload handling.
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
                Access and maintenance
              </h2>
              <p className={lede}>
                Keep credentials private and use a separate token for each phone when you need
                individual revocation. Configure HTTPS for remote access and back up before
                upgrades. Connecting a cloud AI assistant sends the records it requests to that
                provider; self-hosting does not keep those responses local.
              </p>
              <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <Link href={docHref("server")} className={textLink}>
                  Operations guide <ArrowRight className="h-3.5 w-3.5" />
                </Link>
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
