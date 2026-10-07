import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";
import { GitHubIcon } from "@/components/brand-icons";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/page-hero";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

export const metadata = {
  title: "About PulsHealth - Why It Exists and Who Maintains It",
  description:
    "PulsHealth is a one-maintainer open-source project: a free iPhone app to explore, export and sync Apple Health, a database to sync it to (hosted for you, or self-hosted), an MCP server for AI, and a public wire protocol. Why it exists, how it is paid for, and how to get involved.",
  alternates: {
    canonical: "/about/",
  },
};

type Cell = boolean | string;

/** Moved here from the home page: the detail for anyone comparing apps. */
const comparison: { name: string; href?: string; cells: Cell[] }[] = [
  { name: "PulsHealth", cells: [true, true, "Apache-2.0", "Hosted for you, or your Postgres", true, true, "Free app"] },
  { name: "Health Auto Export", href: "https://www.healthyapps.dev/", cells: [false, "Community receivers", "Closed", "Your endpoint, Drive, MQTT…", "Community-documented", false, "Subscription"] },
  { name: "HealthSave", href: "https://healthsave.app/", cells: [false, "Source-available", "Elastic 2.0", "Your TimescaleDB", false, false, "One-time"] },
  { name: "FreeReps", href: "https://freereps.meltforce.org/", cells: [true, true, "MIT", "Your server (Tailscale)", false, true, "Free"] },
  { name: "Apple's export", cells: [false, false, "—", "A zip of XML", false, false, "Free"] },
];
const comparisonColumns = ["Open-source app", "Open-source backend", "License", "Where data lives", "Wire format specified", "AI assistant access", "Price"];

function CellValue({ value }: { value: Cell }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-brand" aria-label="Yes" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-muted-foreground/60" aria-label="No" />;
  return <span className="text-muted-foreground">{value}</span>;
}

const prose =
  "prose prose-lg mx-auto max-w-3xl dark:prose-invert prose-a:text-brand prose-a:no-underline hover:prose-a:underline";

export default function AboutPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <PageHero
        eyebrow="About the project"
        title="About PulsHealth"
        lede="PulsHealth is a one-maintainer open-source project: a free iPhone app that gets your Apple Health data out of the phone, and everything needed to use it, with AI or with your own tools."
      >
        <Button asChild size="lg">
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">
            <GitHubIcon className="mr-2 h-4 w-4" />
            Read the Source
          </a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/#how-it-works">
            How It Works
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </PageHero>

      <section className="container mx-auto max-w-7xl px-4 py-20">
        <div className={prose}>
          <h2>Why it exists</h2>
          <p>
            Apple Health keeps years of your data behind an API that only apps on your phone can
            read. The built-in export is a zip file of XML. Most apps that get the data out keep a
            copy, charge a subscription, or both. I wanted my own history in a database I could
            query with SQL, chart in Grafana, and use with an AI assistant, without handing it to
            anyone else.
          </p>
          <p>
            The app reads Apple Health, lets you explore and export it, and posts every sample to
            the one database you set up: your own, or the PulsHealth database, which I host for
            people who would rather not run a server. Connected to an AI assistant, that database
            gives it your whole history to work from.
          </p>

          <h2>Open source, or run for you</h2>
          <p>
            The app, the self-hosted stack, the protocol and the knowledge base are free and
            Apache-2.0. The PulsHealth database at{" "}
            <a href="https://app.pulshealth.com/signup">app.pulshealth.com</a> is that same
            open-source stack, run for you: I keep the database, the viewer and the AI connection
            going. Your data there is yours: shown back only to you and to the assistants you
            connect, and deleted when you delete your account.
          </p>

          <h2>Why the wire format is public</h2>
          <p>
            The self-hosted stack in the repository is one receiver, not the only one. The format
            the app speaks, the Puls Sync Protocol, is written down with a JSON Schema for every
            line type, a fixture corpus, a conformance checker and a complete receiver in one
            Python file. If you would rather connect your own database, the spec is enough to do it.
          </p>

          <h2>Who maintains it</h2>
          <p>
            One person. I wrote the app, the sync library, the self-hosted stack, the protocol and this
            site, and I run the stack on my own data. Bugs, questions and protocol gaps go through{" "}
            <a href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer">
              GitHub issues
            </a>
            , where the answer helps the next person too. For help with health data and AI more
            broadly, there is <Link href="/consulting">consulting</Link>.
          </p>

          <h2>What it is not</h2>
          <ul>
            <li>
              Not a lock-in. Everything the hosted database does, you can run yourself from the
              same repository.
            </li>
            <li>
              No telemetry. The app has zero third-party dependencies and sends the developer
              nothing, unless you choose the PulsHealth database as the place to sync. The{" "}
              <Link href="/privacy">privacy policy</Link> has the details.
            </li>
            <li>Not a medical device. It moves data; it does not interpret it.</li>
          </ul>
        </div>

        <div className="mx-auto mt-16 max-w-5xl">
          <div className="mx-auto max-w-3xl">
            <h2 id="compared" className="scroll-mt-24 text-3xl font-bold tracking-tight">
              Compared with the alternatives
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Other ways to get Apple Health out of the phone, and where they differ.
            </p>
          </div>
          <div className="mt-8 overflow-x-auto rounded-xl border bg-card">
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
            <a href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
              open an issue
            </a>{" "}
            and it will be corrected.
          </p>
        </div>

        <div className={`${prose} mt-16`}>
          <h2>How to help</h2>
          <p>
            Try it and report what breaks. Implement the protocol against your own backend and
            tell me where the spec was unclear. Fix a knowledge-base page that is wrong. Star the
            repository to follow along. It is Apache-2.0, so you can fork it if the project ever
            stops.
          </p>
        </div>
      </section>
    </main>
  );
}
