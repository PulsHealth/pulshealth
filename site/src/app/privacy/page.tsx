import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const GITHUB = "https://github.com/PulsHealth/pulshealth";

export const metadata = {
  alternates: {
    canonical: '/privacy/',
  },
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background pb-20">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-4xl font-bold tracking-tight mb-4">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last Updated: September 8, 2026</p>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Privacy at a Glance</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-6 space-y-2">
              <li>The developer receives NO health data — there is no PulsHealth account, service, or server</li>
              <li>Your health data goes to exactly one place: the server YOU run and configure</li>
              <li>HealthKit access is read-only — the app never writes to Apple Health</li>
              <li>No analytics, advertising, tracking, or third-party SDKs in the app</li>
              <li>Your server token lives in the iOS Keychain; the app stores no health samples</li>
              <li>This website uses anonymous analytics (GA4) — the app does not, and no health data is ever sent to it</li>
            </ul>
          </CardContent>
        </Card>

        <div className="prose prose-zinc dark:prose-invert max-w-none">
          <p>
            PulsHealth is an open-source iOS app that copies the health data on your iPhone to a
            server <strong>you</strong> run. This policy describes what the app does with your data.
            It is short because the app does very little: it reads Apple Health, it uploads to the
            one address you type in, and that is the whole of it.
          </p>
          <p>
            The source is public, so none of this is a promise you have to take on trust — it is
            checkable at{" "}
            <a href={GITHUB} target="_blank" rel="noopener noreferrer">github.com/PulsHealth/pulshealth</a>.
            The canonical, version-controlled copy of this policy lives in that repository at{" "}
            <a href={`${GITHUB}/blob/main/docs/privacy-policy.md`} target="_blank" rel="noopener noreferrer">
              docs/privacy-policy.md
            </a>.
          </p>

          <h2>The Short Version</h2>
          <ul>
            <li>
              <strong>The developer of PulsHealth receives no data from you.</strong> None. There is
              no PulsHealth account, no PulsHealth service, no telemetry endpoint, and no server
              operated by the developer that the app talks to.
            </li>
            <li>
              <strong>Your health data goes to one place: the server you configure.</strong> The app
              uploads only to the URL you enter (or scan from a pairing code) in the app. It has no
              other destination compiled into it.
            </li>
            <li>
              <strong>No analytics, no advertising, no tracking, no third-party SDKs.</strong> The
              app and its PulsHealthSync library have zero third-party dependencies. Nothing
              profiles you, and no identifier is shared with anyone.
            </li>
            <li>
              <strong>HealthKit access is read-only.</strong> PulsHealth asks Apple Health for read
              permission and never writes, edits, or deletes anything in Apple Health.
            </li>
            <li>
              <strong>You choose what is read.</strong> Nothing is read until you pick the data
              types and iOS grants permission, and you can change or revoke that at any time.
            </li>
          </ul>

          <h2>What the App Reads</h2>
          <p>
            Only the Apple Health data types you enable in the app, and only for the date range you
            set. Depending on your selection this can include quantities (steps, heart rate, energy,
            weight, blood oxygen, and so on), categories (sleep, mindfulness, symptoms), workouts
            together with their GPS routes and per-second sensor series, and daily activity-ring
            summaries.
          </p>
          <p>
            Some of the types you may enable are particularly sensitive — ECG, State of Mind,
            medication dose events, and workout GPS routes among them. None of these is read unless
            you turn it on and iOS grants permission for it. The full catalogue is visible in the
            app&apos;s Data Types screen and in the project&apos;s{" "}
            <a href={`${GITHUB}/blob/main/docs/protocol/catalog.json`} target="_blank" rel="noopener noreferrer">
              type catalog
            </a>.
          </p>

          <h3>Identity Fields</h3>
          <p>
            If you fill them in, the app also sends the identity fields you typed into it — name,
            email address, date of birth, biological sex — to your own server, so your data is
            stored under a person rather than an anonymous row and so heart-rate zones can be
            computed. Every one of those fields starts unset. You type them into Settings &gt; User;
            the app never reads them from Apple Health or anywhere else, and leaving them blank is
            fully supported.
          </p>

          <h3>Device Identifier</h3>
          <p>
            Each upload also carries a <code>deviceID</code> so your server can tell one phone from
            another. It is a random UUID the app generates for itself on first run — not the
            advertising identifier, not <code>identifierForVendor</code>, not tied to you or to the
            hardware — and it goes only to your server.
          </p>

          <h2>Where It Goes</h2>
          <p>
            To the server URL you configure, over HTTPS, authenticated with a bearer token you also
            configure. That is the only network destination.
          </p>
          <p>
            Plain <code>http://</code> is permitted <strong>only</strong> for hosts on your local
            network (<code>localhost</code>, <code>*.local</code>, and the private IP ranges{" "}
            <code>10.x</code>, <code>172.16&ndash;31.x</code>, <code>192.168.x</code>), because
            self-hosted servers commonly live on a home network where a public TLS certificate is
            awkward. Every other address must be <code>https://</code>; the app refuses to save or
            use a plain-HTTP address for any host outside those ranges. This is enforced both by the
            app&apos;s own validation and by iOS App Transport Security.
          </p>

          <h2>What Stays on the Device</h2>
          <ul>
            <li>
              <strong>The bearer token</strong> is stored in the iOS Keychain, readable after the
              first unlock following a restart so background syncs can run, and bound to this device
              so it is never restored onto another one from a backup. It is never written to the
              app&apos;s state file, and it is scrubbed out of logged error messages and anything
              the app exports.
            </li>
            <li>
              <strong>Sync state</strong> — one file, <code>sync-state.json</code>, in the app&apos;s
              private container, holding your configuration (server URL, chosen types, start date,
              and the identity fields if you filled them in), the opaque HealthKit query anchors,
              per-type counters, and progress watermarks. It is written atomically with iOS file
              protection and is excluded from device backups. It holds <strong>no health
              samples</strong> — those are streamed to your server and not kept in the app.
            </li>
            <li>
              <strong>Logs and background-activity telemetry</strong> — an in-app event log and a
              record of each background wake (when it ran, how long, how many samples moved). They
              stay on the device unless <em>you</em> export them with the share sheet. They hold
              counts and timings, not health values.
            </li>
            <li>
              <strong>App preferences</strong> — a handful of flags in <code>UserDefaults</code>
              {" "}(whether Health access has been requested, whether medication access has been
              requested, whether the first-run flow has been completed, and the background-task
              schedule status). No personal data.
            </li>
          </ul>
          <p>
            Deleting the app deletes all of this from the phone. It does not delete anything already
            uploaded to your server; that is yours to manage.
          </p>

          <h2>Camera</h2>
          <p>
            The app can read a pairing QR code printed by your server so you do not have to type a
            URL, a token and a UUID by hand. That is the <strong>only</strong> use of the camera.
            The camera runs only while the scanning screen is open, no photo or video frame is
            recorded, stored, or transmitted, and nothing but the text of the scanned code leaves
            the scanner. Declining camera access is fully supported: the same screen offers to let
            you type the details instead, and the app works exactly the same way.
          </p>

          <h2>Health Data and Apple&apos;s Rules</h2>
          <p>
            PulsHealth does not use HealthKit data for advertising, marketing, or data-mining
            purposes, and does not disclose HealthKit data to any third party. It is not shared
            with, or sold to, anyone — there is nobody to share it with, because the only recipient
            is your own server.
          </p>

          <h2>Children&apos;s Privacy</h2>
          <p>
            PulsHealth is not directed at children. It collects nothing centrally, so there is no
            children&apos;s data for the developer to hold.
          </p>

          <h2>What You Are Responsible For as a Self-Hoster</h2>
          <p>
            Because you run the server, the parts of the system that would normally be a
            provider&apos;s responsibility are yours:
          </p>
          <ul>
            <li>
              <strong>Where the server runs and who can reach it.</strong> Exposing the ingest
              endpoint to the internet, putting it behind a VPN, or keeping it on your LAN is your
              decision. The project&apos;s documentation binds every service to loopback by default.
            </li>
            <li>
              <strong>TLS.</strong> The app requires HTTPS for anything that is not a local-network
              host, but the certificate and the reverse proxy in front of the server are yours to
              provide.
            </li>
            <li>
              <strong>The bearer token.</strong> It is a single shared secret. Anyone who has it can
              upload and delete data on your server. Rotate it if it leaks.
            </li>
            <li>
              <strong>Data at rest, backups, and deletion.</strong> Your database holds identifiable
              health data. Encryption at rest, retention, and honouring your own deletion requests
              are yours to arrange. The project ships a backup service, but it is opt-in and off
              until you turn it on — until then the Postgres volume is the only copy.
            </li>
            <li>
              <strong>Anyone else you let use your server.</strong> If you host other people&apos;s
              data, you are the data controller for it, and any obligations that come with that are
              yours.
            </li>
            <li>
              <strong>Anything you connect to the database.</strong> Grafana, the web viewer, the
              MCP server for AI assistants, notebooks, and your own queries all read the same
              database. What you point at it, and what those tools do with the data, is outside the
              app&apos;s control.
            </li>
          </ul>

          <h2>This Website</h2>
          <p>
            Everything above is about the app. This section is about pulshealth.com, which is a
            separate thing and behaves differently.
          </p>
          <p>
            This website uses Google Analytics 4 to collect anonymous pageview and traffic-source
            data. That is the site&apos;s only third-party service. It has no access to any health
            data, because no health data ever passes through this website — the app does not talk to
            it, and there is no account to sign in to.
          </p>
          <p>
            You can opt out of Google Analytics by installing the{" "}
            <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">
              Google Analytics Opt-out Browser Add-on
            </a>.
          </p>

          <h2>Changes to This Policy</h2>
          <p>
            This document is versioned in the project&apos;s public repository. Changes arrive as
            commits, so the full history is visible in the{" "}
            <a href={`${GITHUB}/commits/main/docs/privacy-policy.md`} target="_blank" rel="noopener noreferrer">
              commit log
            </a>.
          </p>

          <h2>Contact</h2>
          <ul>
            <li>
              <strong>Questions and general contact:</strong> open an issue at{" "}
              <a href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer">
                github.com/PulsHealth/pulshealth/issues
              </a>, or email{" "}
              <a href="mailto:support@pulshealth.com">support@pulshealth.com</a>.
            </li>
            <li>
              <strong>Security problems:</strong> please use GitHub&apos;s{" "}
              <a href={`${GITHUB}/security/advisories/new`} target="_blank" rel="noopener noreferrer">
                private vulnerability reporting
              </a>. Do not file a public issue for a security problem.
            </li>
          </ul>

          <Card className="mt-8">
            <CardContent className="pt-6">
              <p className="italic text-muted-foreground">
                PulsHealth is read-only HealthKit software released under the Apache License 2.0.
                This Privacy Policy complies with Apple&apos;s requirements for HealthKit
                applications.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
