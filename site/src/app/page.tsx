import Link from "next/link";
import { ArrowRight, BookOpen, Bot, Database, FileCode2, Github, Lock, Server, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AnimatedWord } from "@/components/animated-word";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

const pieces = [
  {
    title: "iOS App",
    href: "/app",
    external: false,
    description: "Reads Apple Health — read-only, it never writes back — and streams every sample to your server. A full historical backfill first, then continuous near-real-time updates. Around 80 HealthKit types, workouts with GPS routes, and activity rings.",
    icon: Smartphone,
  },
  {
    title: "Reference Server",
    href: "/sync",
    external: false,
    description: "A Docker Compose stack you run yourself: PostgreSQL 17 with TimescaleDB, a Go ingest API, a read-only product API, provisioned Grafana dashboards, and a web viewer. One command to bring it up.",
    icon: Server,
  },
  {
    title: "Open Wire Protocol",
    href: `${GITHUB}/tree/main/docs/protocol`,
    external: true,
    description: "The Puls Sync Protocol v1 is specified, not just implemented: gzip NDJSON over HTTPS, a JSON Schema for every line type, canonical units, a fixture corpus, and a minimal Python receiver. Write your own backend if you would rather.",
    icon: FileCode2,
  },
  {
    title: "MCP Server for AI",
    href: `${GITHUB}/blob/main/docs/ai.md`,
    external: true,
    description: "A read-only MCP server over the product API, so Claude, Claude Code, or Cursor can answer questions from your own health data — daily metrics, rings, workouts, sleep. ChatGPT connects through the API's OpenAPI document.",
    icon: Bot,
  },
];

const valueProps = [
  {
    title: "Your Server, Your Data",
    description: "There is no PulsHealth service and no PulsHealth account. The app posts to the one URL you enter and nowhere else, so the developer never receives your health data — there is nothing for it to be sent to.",
    icon: Lock,
  },
  {
    title: "Readable, Not Locked In",
    description: "Data lands in plain PostgreSQL you can query with SQL, chart in Grafana, or pull down as CSV and JSONL. The wire format is documented, so a backend of your own is a supported path rather than a hack.",
    icon: Database,
  },
  {
    title: "Auditable by Design",
    description: "App, sync library, server stack, protocol and dashboards are all in one Apache-2.0 repository. Every privacy claim on this site is something you can check against the source rather than take on trust.",
    icon: Github,
  },
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="w-full bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900 pt-20 pb-32 border-b">
        <div className="container mx-auto max-w-7xl px-4 flex flex-col items-center text-center space-y-8">
          <Badge variant="outline" className="px-4 py-1 text-sm rounded-full border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
            Open source &middot; Apache-2.0
          </Badge>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 max-w-4xl">
            <AnimatedWord />
            <br />
            your health data
          </h1>

          <p className="text-lg md:text-xl text-zinc-500 max-w-2xl leading-relaxed">
            PulsHealth syncs Apple Health to a backend you run yourself. The iOS app,
            the server stack and the wire protocol are all open source — and nothing is
            hosted by us, because there is nothing to host.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <Button asChild size="lg" className="bg-brand hover:bg-brand-dark text-brand-foreground">
              <a href={GITHUB} target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-4 w-4" />
                View on GitHub
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/app">
                About the App
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground max-w-xl">
            Pre-release: the app is not on the App Store yet, so you build it from source
            with Xcode. Running it needs a server of your own.
          </p>
        </div>
      </section>

      {/* Project Grid */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">What Is in the Project</h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Apple Health holds years of your data behind an API that only apps can read. PulsHealth
            gets it into a database you own — and everything needed to do that is in one repository.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {pieces.map((piece) => {
            const card = (
              <Card className="h-full transition-all duration-200 hover:border-brand/30 hover:shadow-lg">
                <CardHeader>
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-brand-muted text-brand">
                      <piece.icon className="h-6 w-6" />
                    </div>
                  </div>
                  <CardTitle className="text-xl group-hover:text-brand transition-colors">
                    {piece.title}
                  </CardTitle>
                  <CardDescription className="text-base">
                    {piece.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-brand flex items-center font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    Learn more <ArrowRight className="ml-1 h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            );

            return piece.external ? (
              <a
                key={piece.title}
                href={piece.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                {card}
              </a>
            ) : (
              <Link key={piece.title} href={piece.href} className="group">
                {card}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Value Props */}
      <section className="bg-muted/30 border-y">
        <div className="container mx-auto max-w-7xl px-4 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Why Self-Hosted?</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Health data is about as personal as data gets. The safest place to put it is a machine
              you control.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {valueProps.map((prop) => (
              <div key={prop.title} className="text-center">
                <div className="mx-auto mb-4 p-4 rounded-2xl bg-background border w-fit">
                  <prop.icon className="h-8 w-8 text-brand" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{prop.title}</h3>
                <p className="text-muted-foreground">{prop.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reference Section */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Reference Material</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Background reading on the metrics themselves, kept separately from the software.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <Link href="/knowledge-base" className="group">
            <Card className="h-full transition-all duration-200 hover:border-brand/30 hover:shadow-lg">
              <CardHeader>
                <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mb-4">
                  <BookOpen className="h-6 w-6" />
                </div>
                <CardTitle className="group-hover:text-brand transition-colors">Knowledge Base</CardTitle>
                <CardDescription className="text-base">
                  What each Apple Health metric actually measures — sampling behaviour, typical
                  ranges, and how devices differ.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
          <Link href="/blog" className="group">
            <Card className="h-full transition-all duration-200 hover:border-brand/30 hover:shadow-lg">
              <CardHeader>
                <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mb-4">
                  <FileCode2 className="h-6 w-6" />
                </div>
                <CardTitle className="group-hover:text-brand transition-colors">Blog</CardTitle>
                <CardDescription className="text-base">
                  Longer write-ups on health data, wearables, and the engineering behind moving it
                  around.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-muted/30 border-t">
        <div className="container mx-auto max-w-7xl px-4 py-24 text-center">
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Start with the server
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            The app has nowhere to sync until a backend exists, so bring one up first. The bootstrap
            script generates every secret, starts the stack, and prints a pairing code for the phone.
          </p>
          <div className="mx-auto mb-8 max-w-xl overflow-x-auto rounded-lg border bg-background p-4 text-left">
            <pre className="text-sm font-mono text-muted-foreground">
              <code>{`git clone https://github.com/PulsHealth/pulshealth.git
cd pulshealth
scripts/bootstrap.sh --time-zone Europe/Berlin`}</code>
            </pre>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" className="bg-brand hover:bg-brand-dark text-brand-foreground">
              <a href={GITHUB} target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-4 w-4" />
                Read the Docs on GitHub
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sync">
                The Self-Hosted Stack
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
