import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { campaigns } from "@/lib/campaigns";

export const dynamicParams = false;
export function generateStaticParams() { return campaigns.map(item => ({ campaign: item.id })); }
export const metadata: Metadata = {
  title: "Redirecting to PulsHealth",
  robots: { index: false, follow: true },
  alternates: { canonical: "https://pulshealth.com/" },
};
export default async function CampaignPage({ params }: { params: Promise<{ campaign: string }> }) {
  const { campaign } = await params;
  if (!campaigns.some(item => item.id === campaign)) notFound();
  return (
    <>
      <meta httpEquiv="refresh" content="0;url=/" />
      <p>This link has moved to <Link href="/">pulshealth.com</Link>.</p>
    </>
  );
}
