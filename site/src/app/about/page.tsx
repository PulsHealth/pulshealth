import { Check, Lightbulb, Minus, Unlock, User } from "lucide-react";
import { GitHubIcon } from "@/components/brand-icons";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/page-hero";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

export const metadata = {
  title: "About PulsHealth - Why It Exists and How It Compares",
  description:
    "Why PulsHealth exists, who makes it, and how it compares with other ways to get Apple Health data out of the iPhone.",
  alternates: {
    canonical: "/about/",
  },
};

const points = [
  {
    icon: Lightbulb,
    title: "Why it exists",
    body: "Apple Health keeps years of your data where only apps on your phone can read it, and its export is a zip of XML. I wanted my own history somewhere I could query, chart and hand to an AI, without giving it to anyone else.",
  },
  {
    icon: User,
    title: "Who makes it",
    body: "One person. I build and maintain the app, the database stack and this site, and I run it on my own data every day.",
  },
  {
    icon: Unlock,
    title: "Open by default",
    body: "The app, the database stack, the sync protocol and the knowledge base are Apache-2.0. The hosted PulsHealth database runs the same code, so you can always run it yourself.",
  },
];

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

export default function AboutPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <PageHero
        size="compact"
        title="Your health data, yours to use"
        lede="PulsHealth gets your Apple Health history off the iPhone and into a database you and your AI can use."
      />

      <section className="container mx-auto max-w-6xl px-4 py-20">
        <div className="grid gap-x-10 gap-y-12 md:grid-cols-3">
          {points.map((point) => (
            <div key={point.title}>
              <div className="mb-4 w-fit rounded-xl bg-brand-muted p-3 text-brand">
                <point.icon className="h-6 w-6" aria-hidden />
              </div>
              <h2 className="mb-2 text-lg font-semibold">{point.title}</h2>
              <p className="text-muted-foreground text-pretty">{point.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="compared" className="scroll-mt-20 border-y bg-muted/30">
        <div className="container mx-auto max-w-6xl px-4 py-20">
          <div className="mb-8 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight">How it compares</h2>
            <p className="text-lg text-muted-foreground">
              Other ways to get Apple Health data out of the iPhone.
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
            <a href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
              open an issue
            </a>
            .
          </p>
        </div>
      </section>

      <section className="container mx-auto max-w-6xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight">How to help</h2>
          <p className="mb-8 text-lg text-muted-foreground text-pretty">
            Try it and report what breaks, fix a knowledge-base page that is wrong, or star the
            repository to follow along.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <a href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer">
                Report an issue
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={GITHUB} target="_blank" rel="noopener noreferrer">
                <GitHubIcon className="mr-2 h-4 w-4" />
                Star on GitHub
              </a>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
