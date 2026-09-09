import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  alternates: {
    canonical: '/terms/',
  },
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background pb-20">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-4xl font-bold tracking-tight mb-4">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Last Updated: September 8, 2026</p>

        <div className="prose prose-zinc dark:prose-invert max-w-none">
          <p>Please read these Terms of Use (&quot;Terms&quot;) carefully before using PulsHealth.</p>

          <h2>Acceptance of Terms</h2>
          <p>By downloading, installing, or using PulsHealth, you agree to these Terms. If you do not agree, do not use the App.</p>

          <h2>Description of Service</h2>
          <p>PulsHealth reads health data from Apple HealthKit and syncs it to a server that you run and control. The developer operates no server for your health data and never receives it. The app, the server stack, and the sync protocol are open source under the Apache License 2.0.</p>

          <h2>Free and Open Source</h2>
          <p>PulsHealth is free of charge and there are no paid tiers. Because you supply the server, any hosting, storage, and bandwidth it uses are yours to arrange and pay for.</p>

          <Card className="my-8 border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-900/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="h-5 w-5" />
                Not Medical Advice
              </CardTitle>
            </CardHeader>
            <CardContent className="text-yellow-800 dark:text-yellow-300">
              <p className="mb-2">PulsHealth is a data sync tool, NOT a medical device. The App does not provide medical advice, diagnosis, or treatment recommendations.</p>
              <p className="mb-2">Do not make medical decisions from this data without consulting a qualified healthcare provider.</p>
              <p className="mb-0">Data accuracy depends on the source devices and apps that recorded the data in HealthKit.</p>
            </CardContent>
          </Card>

          <h2>User Responsibilities</h2>
          <p>You are responsible for:</p>
          <ul>
            <li>Maintaining the security of your device</li>
            <li>Running, securing, updating, and backing up the server you sync to</li>
            <li>Deciding how to use and share your health data</li>
            <li>Complying with applicable laws regarding health data</li>
          </ul>

          <h2>Intellectual Property</h2>
          <p>The source code is licensed under the <a href="https://github.com/PulsHealth/pulshealth/blob/main/LICENSE">Apache License 2.0</a>, which grants you the right to use, copy, modify, and distribute it on that licence&apos;s terms. Those terms govern the software and prevail over anything to the contrary here.</p>
          <p>The Apache License does not grant trademark rights. The PulsHealth name, logo, and App Store listing remain the developer&apos;s; a fork must ship under a different name and bundle identifier. Saying that your project works with PulsHealth or implements its sync protocol is fine.</p>

          <h2>Limitation of Liability</h2>
          <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW:</p>
          <p>PulsHealth is provided &quot;AS IS&quot; without warranties of any kind.</p>
          <p>We are not liable for any damages arising from your use of the App, including but not limited to:</p>
          <ul>
            <li>Data loss or corruption</li>
            <li>Inaccurate or incomplete syncs</li>
            <li>Decisions made based on this data</li>
            <li>Unauthorized access to the server you run</li>
          </ul>
          <p>The App is supplied free of charge, and the warranty and liability terms of the Apache License 2.0 apply to the source code.</p>

          <h2>Indemnification</h2>
          <p>You agree to indemnify and hold harmless PulsHealth and its developer from claims arising from your use of the App or violation of these Terms.</p>

          <h2>Termination</h2>
          <p>We may terminate or suspend your access to the App at any time for violation of these Terms.</p>

          <h2>Governing Law</h2>
          <p>These Terms are governed by the laws of California, USA, without regard to conflict of law principles.</p>

          <h2>Changes to Terms</h2>
          <p>We may update these Terms. Continued use after changes constitutes acceptance.</p>

          <h2>Apple-Specific Terms</h2>
          <p>These Terms are between you and PulsHealth&apos;s developer, not Apple. Apple has no obligation to provide maintenance or support.</p>
          <p>Apple is not responsible for any claims related to the App, including product liability, legal compliance, or intellectual property.</p>
          <p>Apple and its subsidiaries are third-party beneficiaries of these Terms and may enforce them.</p>

          <h2>Contact</h2>
          <p>
            Questions about these Terms? Contact us at:{" "}
            <a href="mailto:support@pulshealth.com">support@pulshealth.com</a>
          </p>
        </div>
      </div>
    </main>
  );
}
