import Image from "next/image";
import Link from "next/link";
import { CalendarDays, Share2, Sparkles, Activity, Bike, Dumbbell, Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./workouts.module.css";

const description = "Create running, cycling, strength, swimming, and interval workouts on iPhone. Save, share, and schedule structured workouts for Apple’s Workout app on Apple Watch.";
const socialImage = { url: "/watch-workout-pro/workout-library.jpg", width: 396, height: 860, alt: "Watch Workout Pro workout library on iPhone" };
export const metadata = {
  title: "Watch Workout Pro — Your Custom Workouts on your Apple Watch", description,
  alternates: { canonical: "/watch-workout-pro/" },
  openGraph: { title: "Watch Workout Pro", description, url: "/watch-workout-pro/", images: [socialImage] },
  twitter: { card: "summary_large_image", title: "Watch Workout Pro", description, images: [socialImage.url] },
};

function Phone({ name, alt, priority = false }: { name: string; alt: string; priority?: boolean }) {
  return <div className={styles.phone}><Image src={`/watch-workout-pro/${name}.jpg`} alt={alt} width={396} height={860} priority={priority} sizes="(max-width: 640px) 65vw, 300px" /></div>;
}

const features = [
  { icon: Activity, title: "Build the session you have in mind.", text: "Run repeats. Ride intervals. A strength circuit or a pool session. Choose your activity, add warmup and cooldown, and build work and recovery steps with time, distance, or open goals where supported. Start with an example or make your own.", name: "builder", alt: "Example workout structures for running, cycling, and strength", color: "blue" },
  { icon: Sparkles, title: "Start with an idea. Or a photo.", text: "Describe the session you have in mind, photograph a printed workout, or import a file. Apple Intelligence turns it into editable steps. Review it, adjust it, and make it yours. Source processing stays on your iPhone.", name: "apple-intelligence", alt: "Apple Intelligence workout creation on iPhone", color: "lilac" },
  { icon: CalendarDays, title: "Make time for your next one.", text: "Use a workout today or choose a date. See upcoming sessions in your calendar, and add weekly repeats with Pro. Apple’s Workout app runs and records the workout on your paired Apple Watch.", name: "schedule-calendar", alt: "A calendar of scheduled workouts in Watch Workout Pro", color: "mint" },
  { icon: Share2, title: "Good workouts are worth sharing.", text: "Send a workout link with a readable browser preview. Friends can open it in the app and save their own copy. Keep sessions together in collections, with optional collaboration through iCloud.", name: "workout-sharing", alt: "A workout ready to share or add to a collection", color: "blue" },
];

export default function WatchWorkoutProPage() {
  return <main className={styles.product}>
    <section className="border-b">
      <div className={`container mx-auto max-w-7xl px-5 ${styles.hero}`}>
        <div>
          <h1 className={styles.name}>Watch Workout Pro</h1>
          <p className={styles.headline}>Your Custom Workouts on your Apple Watch</p>
          <p className="mt-7 max-w-lg text-xl leading-relaxed text-muted-foreground">Build a workout on your iPhone. Save the ones you love. Have your next session ready in Apple’s Workout app on your watch.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><a href="#workouts">Explore the app</a></Button>
            <Button asChild size="lg" variant="outline"><Link href="/watch-workout-pro/support/">Get support</Link></Button>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <Phone name="workout-library" alt="Watch Workout Pro library with saved running, strength, and swimming workouts" priority />
          <div className={styles.workoutNote}><Activity aria-hidden /><p>Your next favorite session.</p><span>Your activity. Your intervals. Your kind of workout.</span><div className={styles.intervals} aria-hidden="true">{[24, 55, 32, 55, 32, 55, 32, 24].map((height, i) => <i key={i} style={{ height }} />)}</div></div>
        </div>
      </div>
      <nav aria-label="Watch Workout Pro features" className="container mx-auto flex max-w-7xl flex-wrap justify-between gap-4 border-t px-5 py-6 text-sm font-medium md:text-base"><a href="#workouts">Build your session</a><a href="#apple-intelligence">Create with Apple Intelligence</a><a href="#schedule">Choose a date</a><a href="#sharing">Share a favorite</a></nav>
    </section>

    <div className="container mx-auto max-w-6xl space-y-24 px-5 py-20 md:space-y-32 md:py-28">
      <section id="workouts" className="scroll-mt-24">
        <h2 className={styles.sectionTitle}>A single session.<br />So many ways to make it yours.</h2>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">Start from scratch or explore ten ready-made workouts for running, cycling, strength, HIIT, core, rowing, and swimming. Add warmups, work and recovery intervals, repeats, and cooldowns. Edit and reuse your favorites whenever you need them.</p>
      </section>
      {features.map(({ icon: Icon, title, text, name, alt, color }, i) => <section key={name} id={["build", "apple-intelligence", "schedule", "sharing"][i]} className={styles.feature}>
        <div className={i % 2 === 0 ? styles.copyAfter : undefined}><Icon className="mb-5 h-8 w-8 text-brand" aria-hidden /><h2 className={styles.sectionTitle}>{title}</h2><p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">{text}</p>{name === "apple-intelligence" && <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">Requires iOS 26 or later, a supported device, and available Apple Intelligence.</p>}{name === "workout-sharing" && <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">Public links include workout notes. Anyone with the link can view and download the session.</p>}</div>
        <div className={`${styles.featureVisual} ${styles[color]}`}>{name === "builder" ? <div className={styles.activityExamples} aria-label={alt}>
          <p className={styles.examplesTitle}>Make it your workout.</p>
          {[{ icon: Footprints, activity: "Run", title: "Find your pace", steps: "Warmup · Work and recovery · Cooldown" }, { icon: Bike, activity: "Ride", title: "Change up the effort", steps: "Easy start · Repeat intervals · Easy finish" }, { icon: Dumbbell, activity: "Strength", title: "Build your circuit", steps: "Named exercises · Rest · Repeat" }].map(({ icon: ExampleIcon, activity, title: exampleTitle, steps }) => <div key={activity} className={styles.activityExample}><ExampleIcon aria-hidden /><div><span>{activity}</span><h3>{exampleTitle}</h3><p>{steps}</p></div></div>)}
          <p className={styles.examplesCaption}>Plus swimming, HIIT, core, rowing, and more.</p>
        </div> : <Phone name={name} alt={alt} />}</div>
      </section>)}

      <div className="flex flex-wrap gap-x-8 gap-y-4 font-medium text-brand">
        <Link href="/watch-workout-pro/privacy/" className="hover:underline">Read the privacy policy</Link>
        <a href="mailto:support@pulshealth.com?subject=Watch%20Workout%20Pro%20support" className="hover:underline">support@pulshealth.com</a>
      </div>
    </div>
  </main>;
}
