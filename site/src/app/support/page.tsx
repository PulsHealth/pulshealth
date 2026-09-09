import Link from "next/link";
import { BookOpen, Bug, Github, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

export const metadata = {
  alternates: {
    canonical: '/support/',
  },
};

const supportOptions = [
  {
    title: "Project Documentation",
    description: "Setup, the sync protocol, the database guide, and the AI assistant recipes — all in the repository, alongside the code they describe.",
    icon: Github,
    href: GITHUB,
    cta: "Read the Docs",
    external: true,
  },
  {
    title: "Report an Issue",
    description: "Bugs, feature requests, and questions from people implementing their own receiver. Issue templates cover each of those.",
    icon: Bug,
    href: `${GITHUB}/issues`,
    cta: "Open an Issue",
    external: true,
  },
  {
    title: "Knowledge Base",
    description: "Browse reference material on Apple Health metrics — what each one measures, how it is sampled, and how devices differ.",
    icon: BookOpen,
    href: "/knowledge-base",
    cta: "Browse Reference",
  },
];

export default function SupportPage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero Section */}
      <section className="w-full bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900 pt-20 pb-16 border-b">
        <div className="container mx-auto max-w-7xl px-4 flex flex-col items-center text-center space-y-6">
          <Badge variant="outline" className="px-4 py-1 text-sm rounded-full border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
            Support Center
          </Badge>

          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 max-w-3xl">
            How can we help?
          </h1>

          <p className="text-lg text-zinc-500 max-w-2xl leading-relaxed">
            PulsHealth is an open-source project, so most support happens in the open — in the
            repository, where the answers stay findable for the next person.
          </p>
        </div>
      </section>

      {/* Support Options */}
      <section className="container mx-auto max-w-4xl px-4 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {supportOptions.map((option) => (
            <Card key={option.title} className="h-full">
              <CardHeader className="text-center">
                <div className="p-4 rounded-xl bg-brand-muted text-brand w-fit mx-auto mb-4">
                  <option.icon className="h-8 w-8" />
                </div>
                <CardTitle>{option.title}</CardTitle>
                <CardDescription className="text-base">
                  {option.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button asChild className="bg-brand hover:bg-brand-dark text-brand-foreground">
                  {option.external ? (
                    <a href={option.href} target="_blank" rel="noopener noreferrer">
                      {option.cta}
                    </a>
                  ) : (
                    <Link href={option.href}>{option.cta}</Link>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
          <Card className="h-full">
            <CardHeader className="text-center">
              <div className="p-4 rounded-xl bg-brand-muted text-brand w-fit mx-auto mb-4">
                <Mail className="h-8 w-8" />
              </div>
              <CardTitle>Email</CardTitle>
              <CardDescription className="text-base">
                If an issue is not the right place — a security report, or something you would
                rather not discuss in public — email works too. Security problems should go through
                GitHub&apos;s private vulnerability reporting instead.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button asChild className="bg-brand hover:bg-brand-dark text-brand-foreground">
                <a href="mailto:support@pulshealth.com">Email Support</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
