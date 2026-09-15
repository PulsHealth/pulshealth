import Link from "next/link";
import { ArrowRight, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/page-hero";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

export const metadata = {
  title: "About PulsHealth - Why It Exists and Who Maintains It",
  description:
    "PulsHealth is a one-maintainer open-source project: an iPhone app that copies Apple Health into a database you run, a reference server, and a public wire protocol. Why it exists, what it is not, and how to get involved.",
  alternates: {
    canonical: "/about/",
  },
};

export default function AboutPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <PageHero
        eyebrow="About the project"
        title={
          <>
            Health data is yours.
            <br />
            The tooling should be too.
          </>
        }
        lede="PulsHealth is a one-maintainer open-source project: an iPhone app that copies Apple Health into a database you run, and everything needed to make that useful."
      >
        <Button asChild size="lg" className="bg-brand text-brand-foreground hover:bg-brand-dark">
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">
            <Github className="mr-2 h-4 w-4" />
            Read the Source
          </a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/server">
            Run the Server
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </PageHero>

      <section className="container mx-auto max-w-7xl px-4 py-20">
        <div className="prose prose-lg mx-auto max-w-3xl dark:prose-invert prose-a:text-brand prose-a:no-underline hover:prose-a:underline">
          <h2>Why it exists</h2>
          <p>
            Apple Health holds years of your data behind an API that only apps on your phone can
            read. The built-in export is a zip file of XML. The apps that get the data out for you
            mostly keep a copy, or charge a subscription, or both. I wanted my own history in a
            database I could query with SQL, chart in Grafana, and hand to an AI assistant, without
            trusting anyone else with it along the way.
          </p>
          <p>
            So the app has one job. It reads Apple Health, read-only, and posts every sample to the
            one URL you give it. There is no PulsHealth account and no PulsHealth server. If the
            developer wanted your health data there would be nowhere for it to arrive.
          </p>

          <h2>Why the wire format is public</h2>
          <p>
            The reference server in the repository is one receiver, not the only one. The format
            the app speaks, the Puls Sync Protocol, is written down with a JSON Schema for every
            line type, a fixture corpus, a conformance checker and a complete receiver in one
            Python file. If you would rather write your own backend, that is a supported path
            rather than a reverse-engineering job. The format matters more than the code.
          </p>

          <h2>Who maintains it</h2>
          <p>
            One person, in the open. I wrote the app, the sync library, the server stack, the
            protocol and this site, and I run the stack on my own data. Bugs, questions and
            protocol gaps go through{" "}
            <a href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer">
              GitHub issues
            </a>
            , where the answer helps the next person too. If you want it set up for you, or built
            on, there is a <Link href="/consulting">consulting page</Link>.
          </p>

          <h2>What it is not</h2>
          <ul>
            <li>Not a company, and not a service. There is nothing to sign up for.</li>
            <li>Not a hosted tier, and there are no plans for one. The point is that you host it.</li>
            <li>
              Not a source of telemetry. The app has zero third-party dependencies and phones home
              to nobody; the <Link href="/privacy">privacy policy</Link> is short because there is
              little to say.
            </li>
            <li>
              Not a medical device. It moves data. Interpreting it is between you and someone
              qualified to.
            </li>
          </ul>

          <h2>How to help</h2>
          <p>
            Try it and report what breaks. Implement the protocol against a backend of your own
            and tell me where the spec was unclear. Fix a knowledge-base page that is wrong. Star
            the repository if you want to follow along. All of it is Apache-2.0, so it stays yours
            to fork if I ever stop.
          </p>
        </div>
      </section>
    </main>
  );
}
