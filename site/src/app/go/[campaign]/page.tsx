import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppStoreBadge } from "@/components/app-store-badge";
import { CampaignLinks } from "@/components/campaign-links";
import { campaigns, campaignStoreURL } from "@/lib/campaigns";

export const dynamicParams = false;
export function generateStaticParams() { return campaigns.map(item => ({ campaign: item.id })); }
export async function generateMetadata({ params }: { params: Promise<{ campaign: string }> }): Promise<Metadata> {
  const { campaign } = await params;
  const item = campaigns.find(item => item.id === campaign);
  return { title: item?.headline ?? "PulsHealth", description: item?.body, robots: { index: false, follow: true }, alternates: { canonical: "https://pulshealth.com/" } };
}
export default async function CampaignPage({ params }: { params: Promise<{ campaign: string }> }) {
  const { campaign } = await params;
  const item = campaigns.find(item => item.id === campaign);
  if (!item) notFound();
  return (
    <main>
      <CampaignLinks campaign={campaign} />
      <section className="border-b">
        <div className="container mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:py-24 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <h1 className="max-w-2xl text-5xl font-semibold leading-[1.06] tracking-tight text-balance md:text-6xl">{item.headline}</h1>
            <p className="mt-6 max-w-xl text-xl leading-relaxed text-muted-foreground">{item.body}</p>
            <div className="mt-8"><AppStoreBadge href={campaignStoreURL(campaign)} className="[&_img]:h-14" /></div>
            <p className="mt-5 text-sm text-muted-foreground">iPhone · iOS 17 or later · No account required</p>
            <p className="mt-8 max-w-lg leading-relaxed">Start with unlimited manual exports from the latest 30 days. Pro unlocks your full available history and unlimited sync types.</p>
          </div>
          <div className="mx-auto w-full max-w-[280px]"><Image src="/screenshots/app-export-2.1.png" alt="PulsHealth export options on iPhone" width={600} height={1304} priority className="h-auto w-full rounded-[2rem] border shadow-lg" /></div>
        </div>
      </section>
      <section className="container mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 md:grid-cols-3">
          <div><h2 className="text-xl font-semibold">Choose what to export</h2><p className="mt-3 leading-relaxed text-muted-foreground">Pick your Apple Health data types, dates and file format. Save or share the resulting files yourself.</p></div>
          <div><h2 className="text-xl font-semibold">Keep control</h2><p className="mt-3 leading-relaxed text-muted-foreground">Exploring stays on your phone. Exports leave when you share them. The app has no advertising or analytics SDK.</p></div>
          <div><h2 className="text-xl font-semibold">Go further with Pro</h2><p className="mt-3 leading-relaxed text-muted-foreground">Choose monthly, yearly or Lifetime Pro in the app. Every option includes current and future app features. Hosting is separate.</p></div>
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-6"><AppStoreBadge href={campaignStoreURL(campaign)} /><Link href="/" className="text-brand underline underline-offset-4">Explore everything PulsHealth can do</Link></div>
      </section>
    </main>
  );
}
