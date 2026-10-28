import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { EXAMPLES } from "@/lib/examples";
import {
  ExampleDemo,
  ExampleDetails,
} from "@/components/examples/example-demo";
import styles from "@/components/examples/examples.module.css";
export function generateStaticParams() {
  return EXAMPLES.map((e) => ({ slug: e.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const e = EXAMPLES.find((e) => e.slug === slug);
  return e
    ? {
        title: `${e.title} | PulsHealth`,
        description: e.description,
        alternates: { canonical: `/examples/${slug}/` },
        openGraph: {title:`${e.title} | PulsHealth`,description:e.description,url:`/examples/${slug}/`,images:[{url:`/inspiration-cards/${slug}.png`,width:1200,height:630,alt:e.title}]},
        twitter: {card:"summary_large_image",title:`${e.title} | PulsHealth`,description:e.description,images:[`/inspiration-cards/${slug}.png`]},
      }
    : {};
}
export default async function ExamplePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const example = EXAMPLES.find((e) => e.slug === slug);
  if (!example) notFound();
  return (
    <main className={styles.page}>
      <header className={styles.detailHeader}>
        <Link href="/examples/" className={styles.back}>
          <ChevronLeft size={16} aria-hidden="true" />
          Back
        </Link>
        <h1>{example.title}</h1>
      </header>
      <ExampleDemo slug={example.slug} />
      <ExampleDetails slug={example.slug} />
    </main>
  );
}
