import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/page-hero";

export const metadata = {
  title: "Page not found - PulsHealth",
  robots: { index: false },
};

const places = [
  { title: "Documentation", href: "/docs" },
  { title: "Knowledge Base", href: "/knowledge-base" },
  { title: "Support", href: "/support" },
];

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col">
      <PageHero
        eyebrow="404"
        title="This page is not here"
        lede="It may have moved when the site changed. One of these should get you there."
      >
        <Button asChild size="lg">
          <Link href="/">
            Home
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        {places.map((place) => (
          <Button key={place.href} asChild size="lg" variant="outline">
            <Link href={place.href}>{place.title}</Link>
          </Button>
        ))}
      </PageHero>
    </main>
  );
}
