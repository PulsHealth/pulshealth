import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { WorkoutDetailView } from "@/components/WorkoutDetailView";
import { ChevronRight } from "@/components/Icons";
import { formatActivity } from "@/lib/activity";
import { GROUP_COLOR } from "@/lib/colors";
import { getProfile, getWorkoutDetail, getWorkoutSeries } from "@/lib/queries";
import { formatFull, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const w = await getWorkoutDetail(uuid);
  return { title: w ? `${formatActivity(w.activityType)} — PulsHealth` : "Workout — PulsHealth" };
}

export default async function WorkoutDetailPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const w = await getWorkoutDetail(uuid);
  if (!w) notFound();

  const [series, profile] = await Promise.all([getWorkoutSeries(uuid), getProfile()]);
  const title = formatActivity(w.activityType);

  return (
    <>
      <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", marginBottom: 22 }} className="rise">
        <Link href="/workouts" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          Workouts
        </Link>
        <ChevronRight size={14} />
        <span style={{ color: "var(--fg-soft)" }}>{title}</span>
      </nav>

      <PageHeader
        eyebrow="Workout"
        accent={GROUP_COLOR.workouts}
        title={title}
        subtitle={`${formatFull(w.start)} – ${formatTime(w.end)}`}
      />

      <WorkoutDetailView w={w} series={series} profile={profile} />
    </>
  );
}
