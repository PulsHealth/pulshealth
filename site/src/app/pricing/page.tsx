import { appJsonLd } from "@/lib/product-schema";
import Link from "next/link";
import { PageHero } from "@/components/page-hero";

export const metadata = {
  title: "PulsHealth App Pricing - Free and Pro",
  description: "Start free with Explore, recent exports and five sync types. Pro is US $1.99 monthly, $9.99 yearly or $20 once for Lifetime. Server and services are separate.",
  alternates: { canonical: "/pricing/" },
};

const features = [
  ["Explore on iPhone", "Full access", "Full access"],
  ["Manual file exports", "All supported types", "All supported types"],
  ["Export history", "Last 30 days", "Full available history"],
  ["Automatic sync types", "Up to 5", "All supported types"],
  ["Sync history", "Last 30 days", "Full available history"],
  ["Your own database", "Yes", "Yes"],
];

export default function PricingPage() {
  return (
    <main className="flex-1">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
      <PageHero size="compact" title="Start free. Go further with Pro." lede="Free to download. Open source. Your database stays yours." />
      <section aria-label="App plans" className="container mx-auto max-w-3xl px-5 py-14 md:py-20">
        <div className="grid gap-6 border-b pb-8 sm:grid-cols-2">
          <div><h2 className="text-2xl font-semibold">Free</h2><p className="mt-2 text-muted-foreground">$0. No subscription needed.</p></div>
          <div><h2 className="text-2xl font-semibold">Pro</h2><p className="mt-2 text-muted-foreground">US $1.99 / month, $9.99 / year or $20 once for Lifetime.</p></div>
        </div>
        <table className="mt-4 w-full text-left text-sm sm:text-base">
          <caption className="sr-only">PulsHealth Free and Pro app features</caption>
          <thead><tr className="border-b"><th scope="col" className="py-4 pr-3 font-medium">In the app</th><th scope="col" className="p-3 font-medium">Free</th><th scope="col" className="py-3 pl-3 font-medium">Pro</th></tr></thead>
          <tbody>{features.map(([feature, free, pro]) => (
            <tr key={feature} className="border-b"><th scope="row" className="py-4 pr-3 font-medium">{feature}</th><td className="p-3 text-muted-foreground">{free}</td><td className="py-3 pl-3 text-muted-foreground">{pro}</td></tr>
          ))}</tbody>
        </table>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
          <p>Unlimited manual exports in either plan. Full available history depends on Apple Health permissions and stored data. Free sync can keep accumulating data in your database; the 30-day limit applies to what the app reads, not how long your database keeps it.</p>
          <p>Every Pro option includes all current and future PulsHealth app features. Monthly and yearly subscriptions renew automatically; Lifetime is a one-time purchase with no renewal. Prices shown are US prices; Apple shows your local price before purchase. Buy or restore from the plan row in Settings.</p>
          <p>PulsHealth server, hosting and other services are separate. The open-source database stack is free to run yourself. If a subscription expires, data already in your database stays there. Buying Lifetime does not cancel an existing subscription; manage its renewal separately in your Apple Account.</p>
        </div>
        <nav aria-label="Plan information" className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-brand">
          <Link href="/pro" className="hover:underline">About Pro</Link>
          <Link href="/server" className="hover:underline">Run your own database</Link>
          <Link href="/support" className="hover:underline">Get help</Link>
        </nav>
      </section>
    </main>
  );
}
