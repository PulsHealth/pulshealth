import Link from "next/link";
import { BookOpen, Bug, FileText, Mail, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHero } from "@/components/page-hero";
import { FaqList } from "@/components/faq-list";
import { faq } from "@/lib/faq";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

export const metadata = {
  title: "Support - Getting Help with PulsHealth",
  description:
    "Where to get help with PulsHealth, the app, the PulsHealth database and the self-hosted stack: the FAQ, the documentation, the issue tracker, private vulnerability reporting, and email.",
  alternates: {
    canonical: "/support/",
  },
};

const supportOptions = [
  {
    title: "Documentation",
    description:
      "Connecting an AI assistant, running your own database, the sync protocol, the database guide and exports.",
    icon: FileText,
    href: "/docs",
    cta: "Read the Docs",
  },
  {
    title: "Report an Issue",
    description:
      "Bugs, feature requests, and questions from people implementing their own receiver. Issue templates cover each of those.",
    icon: Bug,
    href: `${GITHUB}/issues`,
    cta: "Open an Issue",
    external: true,
  },
  {
    title: "Security Problems",
    description:
      "Anything that looks like a vulnerability goes through GitHub's private reporting, never a public issue. The security policy says what to expect.",
    icon: ShieldAlert,
    href: `${GITHUB}/security/advisories/new`,
    cta: "Report Privately",
    external: true,
  },
  {
    title: "Email",
    description:
      "For anything you would rather not discuss in public, including your PulsHealth database account. Answers that would help the next person too are better as an issue.",
    icon: Mail,
    href: "mailto:support@pulshealth.com",
    cta: "support@pulshealth.com",
    external: true,
  },
];


export default function SupportPage() {
  return (
    <main className="flex flex-1 flex-col">
      <PageHero
        eyebrow="Support"
        size="compact"
        title="Getting help"
        lede="Start with the answers below. Most sync questions turn out to be iOS behaviour, not bugs."
      />

      <section className="container mx-auto max-w-4xl px-4 py-16">
        <h2 className="mb-4 text-2xl font-bold tracking-tight">The basics</h2>
        <FaqList items={faq.filter((f) => f.topic !== "sync")} />

        <h2 className="mb-2 mt-14 text-2xl font-bold tracking-tight">When a sync looks wrong</h2>
        <p className="mb-4 text-muted-foreground">
          Usually iOS deciding when apps may run, not something the app can change.
        </p>
        <FaqList items={faq.filter((f) => f.topic === "sync")} />
        <p className="mt-6 text-sm text-muted-foreground">
          Still stuck? The{" "}
          <Link href="/docs" className="text-brand underline-offset-4 hover:underline">
            documentation
          </Link>{" "}
          covers connecting an AI, running your own database and the protocol in depth, and the{" "}
          <Link href="/knowledge-base" className="text-brand underline-offset-4 hover:underline">
            knowledge base
          </Link>{" "}
          explains what each Apple Health type actually measures.
        </p>
      </section>

      <section className="border-t bg-muted/30">
        <div className="container mx-auto max-w-4xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight mb-8">Where to go next</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {supportOptions.map((option) => (
              <Card key={option.title} className="h-full">
                <CardHeader>
                  <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mb-3">
                    <option.icon className="h-6 w-6" />
                  </div>
                  <CardTitle>{option.title}</CardTitle>
                  <CardDescription className="text-base">{option.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline">
                    {option.external ? (
                      <a href={option.href} target={option.href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer">
                        {option.cta}
                      </a>
                    ) : (
                      <Link href={option.href}>{option.cta}</Link>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              Building something with health data and AI? See{" "}
              <Link href="/consulting" className="text-brand underline-offset-4 hover:underline">
                consulting
              </Link>
              .
            </span>
          </p>
        </div>
      </section>
    </main>
  );
}
