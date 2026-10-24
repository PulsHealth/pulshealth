import { appJsonLd } from "@/lib/product-schema";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Heart, Moon, Footprints, Activity, Utensils, SlidersHorizontal, Database } from "lucide-react";
import { AppStoreBadge, APP_STORE_URL } from "@/components/app-store-badge";
import { getAllTypes } from "@/lib/api";
import styles from "./features.module.css";
export const metadata = { title: "PulsHealth App Features", description: "Explore Apple Health on iPhone, export CSV and JSON, build custom summaries, and sync your own database.", alternates: { canonical: "/features/" } };
const textLink = "inline-flex items-center gap-2 font-medium text-brand underline-offset-4 hover:underline";
const categories = [
  { icon: Moon, name: "Sleep" }, { icon: Heart, name: "Heart rate" },
  { icon: Footprints, name: "Activity" }, { icon: Activity, name: "Workouts" },
  { icon: Utensils, name: "Nutrition" }, { icon: SlidersHorizontal, name: "And more" },
];

function Phone({ src, alt, className = "", priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  return (
    <div className={`${styles.phone} ${className}`}>
      <Image src={src} alt={alt} width={600} height={1304} priority={priority} className="block w-full" />
    </div>
  );
}

function Feature({ id, title, intro, children, visual, flip = false }: {
  id: string; title: string; intro: string; children: ReactNode; visual: ReactNode; flip?: boolean;
}) {
  return (
    <section id={id} className="grid scroll-mt-24 items-center gap-10 lg:grid-cols-2 lg:gap-20">
      <div className={flip ? "lg:order-2" : undefined}>
        <h2 className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-tight text-balance md:text-5xl">{title}</h2>
        <p className="mt-5 text-xl font-medium text-foreground">{intro}</p>
        <div className="mt-4 max-w-lg space-y-5 text-lg leading-relaxed text-muted-foreground text-pretty">{children}</div>
      </div>
      <div className={`min-w-0 ${flip ? "lg:order-1" : ""}`}>{visual}</div>
    </section>
  );
}

export default async function FeaturesPage() {
 const kbCount = (await getAllTypes()).length;
 return <main className={styles.home}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
 <header className="container mx-auto max-w-7xl px-5 py-20">
 <Link href="/" className="text-brand">PulsHealth</Link>
 <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-tight md:text-7xl">Unlock your health data.</h1>
 <p className="my-7 max-w-2xl text-xl leading-relaxed text-muted-foreground">Explore your Apple Health data, export exactly what you need, and keep your own database up to date. You choose the detail.</p>
 <AppStoreBadge />
 </header>
 <div className="container mx-auto max-w-7xl space-y-24 px-5 pb-24">
        <Feature id="export" title="Export what matters." intro="Your data, dates, and format." flip visual={
          <div className={styles.exportVisual}>
            <div className={styles.fileFormats} aria-label="Export formats: CSV and JSON">
              <div><span>CSV</span><p>Ready for your spreadsheet.</p></div>
              <div><span>JSON</span><p>Ready for your next project.</p></div>
            </div>
            <Phone src="/screenshots/app-export-2.1.png" alt="PulsHealth export builder, with controls for health data types, dates, and file format" />
          </div>
        }>
          <p>Choose the measurements and time range you need. Export the last 30 days free, or your full available history with Pro. Use CSV for spreadsheets or JSON for your own tools and projects.</p>
          <p>Save a personal archive, share a file, or take your data into a new workflow. No account or database required.</p>
          <a href={APP_STORE_URL} data-analytics-placement="export_section" className={textLink}>Get the app <ArrowRight className="h-4 w-4" aria-hidden /></a>
        </Feature>

        <Feature id="iphone" title="Your health. In every detail." intro="Individual readings or custom summaries." visual={
          <div className={styles.detailVisual}>
            <div className={styles.categories}>
              {categories.map(({ icon: Icon, name }) => <div key={name}><Icon className="h-5 w-5" aria-hidden /><span>{name}</span></div>)}
            </div>
            <Phone src="/screenshots/app-type-page.webp" alt="Heart rate details in PulsHealth, including charts, sample counts, sources, and the value distribution" />
          </div>
        }>
          <p>Sleep, heart rate, activity, workouts, nutrition, and more. Explore what Apple Health records and choose what you want to keep.</p>
          <p>Keep individual readings or create custom aggregations, from hourly averages to daily totals. Get the level of detail that works for you.</p>
          <Link href="/knowledge-base" className={textLink}>Discover {kbCount} health data types <ArrowRight className="h-4 w-4" aria-hidden /></Link>
        </Feature>


        <Feature id="sync" title="Keep your database in sync." intro="Your health data, beyond your phone." flip visual={
          <div className={styles.syncVisual}>
            <svg className={styles.syncConnection} viewBox="0 0 500 500" fill="none" preserveAspectRatio="none" aria-hidden>
              {[0, 1, 2].map(i => <path key={i} d={`M 350 ${230 + i * 18} C 250 ${230 + i * 18}, 240 ${220 + i * 18}, 140 ${220 + i * 18}`} stroke="currentColor" strokeOpacity={.2 + i * .1} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
            </svg>
            <div className={styles.syncDestination}>
              <Database size={80} strokeWidth={1.25} aria-hidden />
              <strong>Your database</strong>
              <p>Ready for the web,<br />your tools, and AI.</p>
            </div>
            <Phone src="/screenshots/app-explore.webp" alt="PulsHealth on iPhone, showing health data types you can sync to your own database" />
          </div>
        }>
          <p>Connect your own PulsHealth server or a compatible receiver. Automatic background sync sends new readings as iOS allows, keeping your health history in a database you control.</p>
          <p>Explore it in the web dashboard, use the API, or connect compatible AI tools. Start free with five health data types from the last 30 days.</p>
          <div className="flex flex-wrap gap-6"><Link href="/server/" className={textLink}>Set up a database <ArrowRight aria-hidden className="h-4 w-4" /></Link><Link href="/pricing/" className={textLink}>Compare Free and Pro</Link></div>
        </Feature>
 </div></main>;
}
