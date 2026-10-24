import { appJsonLd } from "@/lib/product-schema";
import Link from "next/link";
import { AppStoreBadge } from "@/components/app-store-badge";
import { PageHero } from "@/components/page-hero";

export const metadata = {
  title: "PulsHealth Pro - Full History and All Sync Types",
  description: "Choose monthly, yearly or one-time Lifetime Pro for full available Apple Health history and all current and future app features. Server and services are separate.",
  alternates: { canonical: "/pro/" },
};

export default function ProPage() {
  return (
    <main className="flex-1">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
      <PageHero
        size="compact"
        title="More of your health history."
        lede="PulsHealth Pro adds full available history and sync for every supported health data type. Your data still goes where you choose."
      />
      <section aria-label="About PulsHealth Pro" className="container mx-auto max-w-3xl space-y-10 px-5 py-14 md:py-20">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Full history. All supported types.</h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">Sync and export as far back as Apple Health allows. Keep every supported type in sync, from sleep and heart rate to workouts and nutrition, with individual readings and custom summaries.</p>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Open source. Your own database.</h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">The app and database stack remain Apache-2.0 open source. Run the free database stack yourself or use a compatible receiver. Choose monthly, yearly or a one-time Lifetime purchase for all current and future app features. PulsHealth server, hosting and other services are separate.</p>
        </div>
        <div className="border-t pt-8">
          <p className="leading-relaxed text-muted-foreground">Start free with Explore, unlimited exports of the last 30 days across all supported types, and sync of up to five types. No account is needed to explore or export.</p>
          <p className="mt-4"><Link href="/pricing" className="text-brand underline-offset-4 hover:underline">Compare Free and Pro</Link></p>
        </div>
        <div className="space-y-4">
          <AppStoreBadge placement="pro" />
          <p className="text-sm text-muted-foreground">Find Pro in the plan row in Settings. Available history depends on Apple Health permissions and what is stored on your phone.</p>
        </div>
      </section>
    </main>
  );
}
