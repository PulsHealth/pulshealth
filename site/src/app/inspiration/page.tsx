import Link from "next/link";
import { EXAMPLES } from "@/lib/examples";
import { ExampleDemo } from "@/components/examples/example-demo";
import styles from "@/components/examples/examples.module.css";
export const metadata = {
  title: "Inspiration | PulsHealth",
  description:
    "Make a health year in review, explore marathon training, compare repeated running routes, turn activity into art, and visualize your walks, runs and rides. Interactive demos using recorded workouts and local examples.",
  alternates: { canonical: "/inspiration/" },
  openGraph: { title: "Inspiration | PulsHealth", description: "What could you build with your health data freed from your phone?", url: "/inspiration/", images: [{url:"/inspiration-cards/index.png",width:1200,height:630,alt:"PulsHealth health data inspiration"}] },
  twitter: {card:"summary_large_image",title:"Inspiration | PulsHealth",images:["/inspiration-cards/index.png"]},
};
export default function ExamplesPage() {
  return (
    <main className={styles.page}>
      <header className={styles.galleryHeader}>
        <h1>Inspiration</h1>
        <p>What could you build with your health data freed from your phone?</p>
      </header>
      <div className={styles.grid}>
        {EXAMPLES.map((example) => (
          <article className={styles.project} key={example.slug}>
            <h2>{example.title}</h2>
            <Link
              className={styles.preview}
              href={`/inspiration/${example.slug}/`}
              aria-label={`View ${example.title}`}
            >
              <ExampleDemo slug={example.slug} compact />
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
