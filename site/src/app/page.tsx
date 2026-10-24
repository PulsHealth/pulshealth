import Link from "next/link";
import { ArrowRight, Check, Code2, Database, GitBranch, LockKeyhole, Smartphone } from "lucide-react";
import { AppStoreBadge, APP_STORE_URL } from "@/components/app-store-badge";
import { HealthDataFlow } from "@/components/health-data-flow";
import { WebAppPreview } from "@/components/web-app-preview";
import { AiSetupPrompt } from "@/components/ai-setup-prompt";
import { FaqList } from "@/components/faq-list";
import { faq } from "@/lib/faq";
import { GITHUB_URL } from "@/lib/github";
import styles from "./home.module.css";

const DEMO_URL = "https://app.pulshealth.com/demo";
const appJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "PulsHealth",
  operatingSystem: "iOS 17 or later",
  applicationCategory: "HealthApplication",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  installUrl: APP_STORE_URL,
  license: "https://www.apache.org/licenses/LICENSE-2.0",
  codeRepository: GITHUB_URL,
  isAccessibleForFree: true,
  description: "Sync, export, and control your Apple Health data. Automatic background sync to a compatible database, flexible CSV and JSON exports, and connections to compatible AI tools through your database. Free to download and open source, with optional Pro subscriptions for full history and unlimited sync types.",
};


export default function HomePage() {
  return (
    <main className={styles.home}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>Unlock your health data.</h1>
          <p className={styles.subtitle}>Sync, export, and control your Apple Health data.</p>
          <div className={styles.promises}>
            <span><Check aria-hidden />Free to start</span>
            <a href={GITHUB_URL}><Check aria-hidden />Open source</a>
            <span><Check aria-hidden />No account required</span>
          </div>
          <div className={styles.heroActions}>
            <AppStoreBadge placement="hero" className="[&_img]:h-12" />
            <a href={DEMO_URL} className={styles.secondaryButton}>Try the dashboard <ArrowRight size={16} aria-hidden /></a>
          </div>
        </div>
        <HealthDataFlow />
      </section>

      <section id="web-app" className={`${styles.section} ${styles.webSection}`}>
        <div id="how-it-works" className={styles.sectionHeading}>
          <div>
            <h2>Your health, with<br className={styles.desktopBreak} /> room to explore.</h2>
            <p>See your day. Look closer at a workout. Build something with your data. Your database brings it all to the web.</p>
          </div>
          <a href={DEMO_URL} className={styles.primaryButton}>Try the dashboard <ArrowRight size={17} aria-hidden /></a>
        </div>
        <WebAppPreview />
        <div className={styles.webDetails}>
          <p>Use your own server, or <a href="https://app.pulshealth.com/signup">request a hosted account</a>.</p>
          <Link href="/docs/api-reference/"><Code2 size={17} aria-hidden />Explore the API</Link>
        </div>
      </section>

      <section id="sync" className={styles.ownershipSection}>
        <div className={`${styles.section} ${styles.ownershipGrid}`}>
          <div>
            <h2>Control your own<br /> health data.</h2>
            <p className={styles.sectionIntro}>Your database. On your server.<br />With a little help from AI.</p>
            <p className={styles.bodyCopy}>Run PulsHealth on a machine you own. Your health history lives in your own PostgreSQL database, ready for the dashboard, API, and AI tools you choose.</p>
            <p className={styles.bodyCopy}>Give your coding assistant our setup prompt. It can walk you through deploying the server and connecting your iPhone.</p>
            <div className={styles.inlineLinks}>
              <Link href="/blog/set-up-pulshealth-with-ai/">Set up with AI <ArrowRight size={16} aria-hidden /></Link>
              <Link href="/server/">Self-hosting guide</Link>
            </div>
            <div className={styles.ownershipFacts}>
              <span><Database size={17} aria-hidden />Your own database</span>
              <span><LockKeyhole size={17} aria-hidden />You choose who gets access</span>
              <span><GitBranch size={17} aria-hidden />Open source, free to self-host</span>
            </div>
          </div>
          <div className={styles.setupVisual}>
            <div className={styles.setupHeader}><span className={styles.assistantIcon}><Code2 size={22} aria-hidden /></span><div><strong>A head start for your AI assistant</strong><p>From setup to your first sync.</p></div></div>
            <AiSetupPrompt />
            <div className={styles.setupSteps} aria-label="Setup steps"><span>Deploy your server</span><ArrowRight size={14} aria-hidden /><span>Pair your iPhone</span><ArrowRight size={14} aria-hidden /><span>Start syncing</span></div>
            <p className={styles.setupNote}>Bring your own server and review the changes your assistant makes. Start free with five sync types and 30 days of history.</p>
          </div>
        </div>
      </section>

      <section id="iphone" className={`${styles.section} ${styles.appDetails}`}>
        <div className={styles.appDetailsIcon}><Smartphone size={32} strokeWidth={1.5} aria-hidden /></div>
        <div><h2>There’s more in the app.</h2><p>Flexible exports. Individual readings. Custom summaries.<br className={styles.desktopBreak} /> Choose exactly what to keep, and how to use it.</p></div>
        <Link href="/features/" className={styles.secondaryButton}>Explore app features <ArrowRight size={16} aria-hidden /></Link>
      </section>

      <section className={`${styles.section} ${styles.faq}`}>
        <h2>A few things to know.</h2>
        <FaqList items={faq.filter(item => item.home)} />
        <p>More answers on the <Link href="/support/">support page</Link>.</p>
      </section>
      <section className={`${styles.section} ${styles.finalCta}`}>
        <h2>Your data. Your next possibility.</h2>
        <p>Start with an export. See where it takes you.</p>
        <AppStoreBadge placement="closing_cta" className="[&_img]:h-12" />
      </section>
    </main>
  );
}
