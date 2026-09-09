import Link from "next/link";
import { Mail, MessageSquare, Briefcase, Lightbulb, Code, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import dynamic from "next/dynamic";

const QuoteRequestDialog = dynamic(
  () => import("@/components/quote-request-dialog").then((mod) => mod.QuoteRequestDialog),
);

export const metadata = {
  alternates: {
    canonical: '/consulting/',
  },
};

const services = [
  {
    title: "AI Agent Integration",
    description: "Integrate the PulsHealth AI Health Agent, PrivacyProtect Layer, or Knowledge Base into your product. We help you choose the right integration path — MCP, agent-to-agent, or direct query layer.",
    icon: Code,
  },
  {
    title: "Health Data Strategy",
    description: "Develop a strategy for collecting, normalizing, and utilizing wearable health data across devices and platforms. We help you navigate privacy, consent, and clinical accuracy.",
    icon: Lightbulb,
  },
  {
    title: "Research Support",
    description: "End-to-end support for health data research projects — from study design and data collection with PulsHealthSync to analysis with clinical grounding from the Knowledge Base.",
    icon: Database,
  },
  {
    title: "Custom Solutions",
    description: "Need something tailored? We build custom health data pipelines, privacy-preserving architectures, and AI agent configurations for your specific use case.",
    icon: Briefcase,
  },
];

export default function ConsultingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="w-full bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900 pt-20 pb-32 border-b">
        <div className="container mx-auto max-w-7xl px-4 flex flex-col items-center text-center space-y-8">
          <Badge variant="outline" className="px-4 py-1 text-sm rounded-full border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
            Consulting Services
          </Badge>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 max-w-4xl">
            Expert guidance for using{" "}
            <span className="text-brand">wearable health data</span>
          </h1>

          <p className="text-lg md:text-xl text-zinc-500 max-w-2xl leading-relaxed">
            Our team brings years of experience from the Apple Health team, AI at Google, and clinical practice. We help you integrate PulsHealth solutions and build health AI products that work.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <QuoteRequestDialog>
              <Button size="lg" className="bg-brand hover:bg-brand-dark text-brand-foreground">
                <Mail className="mr-2 h-4 w-4" />
                Contact Us
              </Button>
            </QuoteRequestDialog>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">How we can help</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We help builders integrate PulsHealth solutions and ship health AI products with confidence.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {services.map((service) => (
            <Card key={service.title} className="h-full">
              <CardHeader>
                <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mb-4">
                  <service.icon className="h-6 w-6" />
                </div>
                <CardTitle>{service.title}</CardTitle>
                <CardDescription className="text-base">
                  {service.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* Contact Section */}
      <section className="bg-muted/30 border-y">
        <div className="container mx-auto max-w-7xl px-4 py-24">
          <div className="max-w-2xl mx-auto text-center">
            <MessageSquare className="h-12 w-12 text-brand mx-auto mb-6" />
            <h2 className="text-3xl font-bold tracking-tight mb-4">Let&apos;s talk</h2>
            <p className="text-lg text-muted-foreground mb-8">
              Tell us about your project and we&apos;ll get back to you.
            </p>

            <Card>
              <CardContent className="pt-6">
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-brand-muted text-brand">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium">Email</p>
                      <a href="mailto:support@pulshealth.com" className="text-brand hover:underline">
                        support@pulshealth.com
                      </a>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <p className="text-sm text-muted-foreground mt-8">
              For general support questions, visit our{" "}
              <Link href="/support" className="text-brand hover:underline">
                support page
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
