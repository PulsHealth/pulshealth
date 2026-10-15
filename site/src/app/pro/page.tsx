import Link from "next/link";
import { AppStoreBadge } from "@/components/app-store-badge";
import { PageHero } from "@/components/page-hero";

export const metadata = {
  title: "PulsHealth Pro - Full History and All Sync Types",
  description: "The optional PulsHealth app subscription unlocks full available Apple Health history and sync for all supported types. Open source, with your own database.",
  alternates: { canonical: "/pro/" },
};

export default function ProPage() {
  return (
    <main className="flex-1">
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
          <p className="mt-3 leading-relaxed text-muted-foreground">The app and database stack remain Apache-2.0 open source. Run the free database stack yourself or use a compatible receiver. The Pro subscription is for the iPhone app; hosting is separate.</p>
        </div>
        <div className="border-t pt-8">
          <p className="leading-relaxed text-muted-foreground">Start free with Explore, unlimited exports of the last 30 days across all supported types, and sync of up to five types. No account is needed to explore or export.</p>
          <p className="mt-4"><Link href="/pricing" className="text-brand underline-offset-4 hover:underline">Compare Free and Pro</Link></p>
        </div>
        <div className="space-y-4">
          <AppStoreBadge />
          <p className="text-sm text-muted-foreground">Find Pro in the app under Settings → Plan. Available history depends on Apple Health permissions and what is stored on your phone.</p>
        </div>
      </section>
    </main>
  );
}
