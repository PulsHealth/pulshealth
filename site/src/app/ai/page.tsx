import Link from "next/link";
import { ArrowRight, Brain, BookOpen, Shield, Sparkles, Code, MessageSquare, CheckCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import dynamic from "next/dynamic";

const WaitlistDialog = dynamic(
  () => import("@/components/waitlist-dialog").then((mod) => mod.WaitlistDialog),
);

export const metadata = {
  alternates: {
    canonical: '/ai/',
  },
};

const features = [
  {
    title: "Knowledge Base Grounding",
    description: "The agent has access to PulsHealth's extensive Wearable Knowledge Base — typical ranges, device-specific accuracy, sampling characteristics, and clinical significance. No hallucinated health information.",
    icon: BookOpen,
  },
  {
    title: "Tool-Based Fact Checking",
    description: "The agent verifies its own claims against the knowledge base before responding. It actively retrieves and cross-references authoritative metric data during reasoning.",
    icon: CheckCircle,
  },
  {
    title: "LLM-as-a-Judge Testing",
    description: "A continuous evaluation pipeline where LLM judges score agent responses against clinician-validated ground truth across clinical scenarios, edge cases, and device-specific nuances.",
    icon: Brain,
  },
  {
    title: "Multiple Integration Paths",
    description: "Use out of the box, or integrate via MCP, agent-to-agent communication, or the PrivacyProtect query layer directly with your own agent.",
    icon: Code,
  },
  {
    title: "Clinical Input",
    description: "Our testing corpus is built and reviewed with input from clinicians and health data scientists. Ground truth comes from real clinical expertise, not LLM-generated benchmarks.",
    icon: Sparkles,
  },
  {
    title: "Direct Individual Use",
    description: "Not just for developers — individuals can ask questions about their own health data in plain language and get clinically grounded answers.",
    icon: MessageSquare,
  },
];

export default function AIPage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="w-full bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900 pt-20 pb-32 border-b">
        <div className="container mx-auto max-w-7xl px-4 flex flex-col items-center text-center space-y-8">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 max-w-4xl">
            AI Health Agent for{" "}
            <span className="text-brand">wearable health data</span>
          </h1>

          <p className="text-lg md:text-xl text-zinc-500 max-w-2xl leading-relaxed">
            AI health agent with clinical grounding and privacy-preserving reasoning. Integrate into your product or use directly to unlock your health data.
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

      {/* Features Section */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Clinical grounding and fact checking</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Health is a domain where accuracy is non-negotiable. The AI Health Agent is grounded in clinical truth through multiple layers.
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

      {/* Privacy Section */}
      <section className="bg-muted/30 border-y">
        <div className="container mx-auto max-w-7xl px-4 py-24">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-4">
              Privacy first
            </h2>
            <p className="text-lg text-muted-foreground mb-6">
              The AI Health Agent works with the <Link href="/privacy-protect" className="text-brand hover:underline">PrivacyProtect Layer</Link> to ensure health data is handled responsibly at every step.
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-brand mt-0.5" />
                <span>An on-device LLM determines the minimum data needed — nothing leaves the device unless required</span>
              </li>
              <li className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-brand mt-0.5" />
                <span>When cloud models are needed, data is aggregated, filtered, and anonymized before sending</span>
              </li>
              <li className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-brand mt-0.5" />
                <span>You stay in control — cloud processing is only suggested when genuinely necessary</span>
              </li>
              <li className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-brand mt-0.5" />
                <span>Full visibility into what data was shared, with whom, and when</span>
              </li>
            </ul>
          </div>
          <div className="bg-muted/30 rounded-2xl p-8 border">
            <Lock className="h-24 w-24 text-brand mx-auto mb-6" />
            <p className="text-center text-muted-foreground">
              The PrivacyProtect Layer is also available as standalone middleware for your own agent. <Link href="/privacy-protect" className="text-brand hover:underline">Learn more</Link>.
            </p>
          </div>
        </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="container mx-auto max-w-7xl px-4 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">How to get started</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h3 className="text-2xl font-semibold">Use it directly</h3>
            <p className="text-muted-foreground">
              Ask questions about your health data in plain language. Get insights backed by clinical context, not just raw numbers.
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-brand mt-0.5" />
                <span>Natural language questions about your wearable data</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-brand mt-0.5" />
                <span>Clinically grounded answers with context from the knowledge base</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-brand mt-0.5" />
                <span>On-device privacy — your data stays under your control</span>
              </li>
            </ul>
          </div>
          <div className="space-y-6">
            <div className="p-3 rounded-xl bg-brand-muted text-brand w-fit">
              <Code className="h-6 w-6" />
            </div>
            <h3 className="text-2xl font-semibold">Integrate with your system</h3>
            <p className="text-muted-foreground">
              Drop the AI Health Agent into your existing architecture. Pick the integration path that fits — no rework required.
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-brand mt-0.5" />
                <span><strong>MCP</strong> — Connect via the Model Context Protocol for tool-based integration</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-brand mt-0.5" />
                <span><strong>Agent-to-agent</strong> — Let your agent communicate directly with the PulsHealth agent</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-brand mt-0.5" />
                <span><strong>Query layer</strong> — Use the PrivacyProtect query layer directly with your own agent</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-gradient text-white">
        <div className="container mx-auto max-w-7xl px-4 py-24 text-center">
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Build health AI that users can trust
          </h2>
          <p className="text-lg opacity-90 max-w-2xl mx-auto mb-8">
            Join the waitlist for integration access. Individuals can also use the AI Health Agent directly in the PulsHealth app.
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
