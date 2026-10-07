import { Bot, ChartLine, ClipboardCheck, Database, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/page-hero";
import dynamic from "next/dynamic";

const QuoteRequestDialog = dynamic(
  () => import("@/components/quote-request-dialog").then((mod) => mod.QuoteRequestDialog),
);

const EMAIL = "support@pulshealth.com";

export const metadata = {
  title: "Consulting - Health Data and AI",
  description: "Help with health data and AI: getting wearable data into shape, putting models to work on it, and checking that the answers hold up.",
  alternates: {
    canonical: '/consulting/',
  },
};

const areas = [
  {
    title: "Health data",
    description: "Getting data out of wearables and health apps, cleaned up and somewhere you can query it.",
    icon: Database,
  },
  {
    title: "AI on health data",
    description: "Connecting models and agents to health data, so they answer from real numbers.",
    icon: Bot,
  },
  {
    title: "Evaluation",
    description: "Measuring whether a health AI feature is accurate and actually useful.",
    icon: ClipboardCheck,
  },
  {
    title: "Analysis",
    description: "Turning years of sensor data into metrics, trends and decisions.",
    icon: ChartLine,
  },
];

function ContactButton({ label }: { label: string }) {
  return (
    <QuoteRequestDialog>
      <Button size="lg">
        <Mail className="mr-2 h-4 w-4" />
        {label}
      </Button>
    </QuoteRequestDialog>
  );
}

export default function ConsultingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <PageHero
        eyebrow="Consulting"
        title={<>Let&apos;s build something <span className="text-brand">together</span></>}
        lede="For teams working with wearables, health records and AI."
      >
        <ContactButton label="Get in touch" />
      </PageHero>

      <section className="container mx-auto max-w-6xl px-4 py-20">
        <h2 className="sr-only">Where I can help</h2>
        <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {areas.map((area) => (
            <div key={area.title}>
              <div className="mb-4 w-fit rounded-xl bg-brand-muted p-3 text-brand">
                <area.icon className="h-6 w-6" aria-hidden />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{area.title}</h3>
              <p className="text-muted-foreground text-pretty">{area.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container mx-auto max-w-6xl px-4 pb-24">
        <div className="rounded-2xl border bg-brand-muted/50 px-6 py-14 text-center md:px-16">
          <h2 className="mb-3 text-3xl font-bold tracking-tight">Get in touch</h2>
          <p className="mx-auto mb-8 max-w-xl text-lg text-muted-foreground text-pretty">
            Tell me what you are working on and where you are stuck. I read every message and
            reply within a few days.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <ContactButton label="Send a message" />
            <a href={`mailto:${EMAIL}`} className="text-sm text-muted-foreground hover:text-foreground">
              or email <span className="text-brand">{EMAIL}</span>
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
