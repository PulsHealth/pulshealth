import Link from "next/link";
import { ArrowRight, Shield, Lock, Eye, Server, Cpu, FileCheck, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import dynamic from "next/dynamic";

const WaitlistDialog = dynamic(
  () => import("@/components/waitlist-dialog").then((mod) => mod.WaitlistDialog),
);

export const metadata = {
  alternates: {
    canonical: '/privacy-protect/',
  },
};

const features = [
  {
    title: "On-Device Processing",
    description: "An on-device LLM analyzes queries and identifies the minimum necessary clinical data before anything leaves the device.",
    icon: Cpu,
  },
  {
    title: "Minimum Necessary Data",
    description: "Only the data required to answer a specific question is extracted. Full health records are never sent to external services.",
    icon: Lock,
  },
  {
    title: "Cloud Query Anonymization",
    description: "When cloud LLMs are needed, data passes through aggregation, filtering, date fuzzing, and noise injection to help anonymize.",
    icon: Shield,
  },
  {
    title: "Audit Trail",
    description: "Full awareness of what health data has been sent to which service, giving users and developers complete visibility.",
    icon: FileCheck,
  },
  {
    title: "User Control",
    description: "Users stay in control at every step. They can use only the on-device model, and only when necessary will it suggest sending data off-device.",
    icon: Eye,
  },
  {
    title: "Middleware Architecture",
    description: "Drop-in middleware for any health AI pipeline. Works as a standalone layer between your agent and health data sources.",
    icon: Server,
  },
];

export default function PrivacyProtectPage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="w-full bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900 pt-20 pb-32 border-b">
        <div className="container mx-auto max-w-7xl px-4 flex flex-col items-center text-center space-y-8">
          <Badge variant="outline" className="px-4 py-1 text-sm rounded-full border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
            PrivacyProtect Layer
          </Badge>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 max-w-4xl">
            Privacy-preserving middleware for{" "}
            <span className="text-brand">health AI</span>
          </h1>

          <p className="text-lg md:text-xl text-zinc-500 max-w-2xl leading-relaxed">
            Use it as part of the PulsHealth AI Health Agent or integrate it standalone into your own agent. On-device processing, minimum necessary data, and full user control.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <WaitlistDialog>
              <Button size="lg" className="bg-brand hover:bg-brand-dark text-brand-foreground">
                Join Waitlist
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </WaitlistDialog>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">How it works</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            A multi-step privacy pipeline that keeps users in control.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-brand text-brand-foreground flex items-center justify-center text-xl font-bold">
              1
            </div>
            <h3 className="text-lg font-semibold mb-2">On-Device Analysis</h3>
            <p className="text-muted-foreground text-sm">
              An on-device LLM analyzes the query and identifies the minimum necessary clinical data to answer it.
            </p>
          </div>
          <div className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-brand text-brand-foreground flex items-center justify-center text-xl font-bold">
              2
            </div>
            <h3 className="text-lg font-semibold mb-2">Data Filtering</h3>
            <p className="text-muted-foreground text-sm">
              Only the relevant data is extracted and filtered. Full health records never leave the device.
            </p>
          </div>
          <div className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-brand text-brand-foreground flex items-center justify-center text-xl font-bold">
              3
            </div>
            <h3 className="text-lg font-semibold mb-2">Privacy Query Layer</h3>
            <p className="text-muted-foreground text-sm">
              When cloud LLMs are needed, data passes through aggregation, date fuzzing, and noise injection.
            </p>
          </div>
          <div className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-brand text-brand-foreground flex items-center justify-center text-xl font-bold">
              4
            </div>
            <h3 className="text-lg font-semibold mb-2">User Control</h3>
            <p className="text-muted-foreground text-sm">
              Users approve what gets sent, see an audit trail, and can opt for on-device only at any time.
            </p>
          </div>
        </div>
      </section>

      {/* Two Modes Section */}
      <section className="bg-muted/30 border-y">
        <div className="container mx-auto max-w-7xl px-4 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Two modes of operation</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Use PrivacyProtect as part of the PulsHealth ecosystem or integrate it into your own agent.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="h-full">
              <CardHeader>
                <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mb-4">
                  <Bot className="h-6 w-6" />
                </div>
                <CardTitle>Built into the AI Health Agent</CardTitle>
                <CardDescription className="text-base">
                  The PrivacyProtect Layer is deeply integrated into the <Link href="/ai" className="text-brand hover:underline">PulsHealth AI Health Agent</Link>. Every query passes through the privacy pipeline automatically — no configuration needed. The on-device and cloud models have a conversation to solve your goals while protecting your health data.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="h-full">
              <CardHeader>
                <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mb-4">
                  <Server className="h-6 w-6" />
                </div>
                <CardTitle>Standalone middleware</CardTitle>
                <CardDescription className="text-base">
                  Integrate the PrivacyProtect Layer as middleware in your own health AI pipeline. It sits between your agent and health data sources, handling on-device filtering, cloud query anonymization, and audit trails. Your agent gets the data it needs; users keep control.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Features</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Every layer designed for privacy without sacrificing capability.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <Card key={feature.title} className="h-full">
              <CardHeader>
                <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit mb-4">
                  <feature.icon className="h-6 w-6" />
                </div>
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription className="text-base">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-gradient text-white">
        <div className="container mx-auto max-w-7xl px-4 py-24 text-center">
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Add privacy-preserving health queries to your agent
          </h2>
          <p className="text-lg opacity-90 max-w-2xl mx-auto mb-8">
            Join the waitlist for API and SDK access. Build health AI that users can trust with their most personal data.
          </p>
          <WaitlistDialog>
            <Button size="lg" variant="secondary">
              Join Waitlist
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </WaitlistDialog>
        </div>
      </section>
    </main>
  );
}
