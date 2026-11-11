/** Synthetic UI fixtures only. No invite token, authorization or upload endpoint. */
export type GroupPreview = {
  id: string;
  name: string;
  organizer: string;
  purpose: string;
  metrics: string[];
  start: string;
  end: string;
  destination: "hosted" | "separate";
  host: string;
  retention: string;
};

export const PREVIEW_GROUPS: GroupPreview[] = [
  { id: "move-together", name: "Move Together", organizer: "Northside Movement Lab",
    purpose: "Help us understand how a weekly group class changes everyday activity.",
    metrics: ["Steps", "Workouts", "Resting heart rate"], start: "2026-11-01", end: "2026-12-13",
    destination: "hosted", host: "PulsHealth · group access", retention: "90 days after the program ends" },
  { id: "sleep-study", name: "Rest & Recovery", organizer: "Example Sleep Research",
    purpose: "Explore the relationship between sleep and recovery over six weeks.",
    metrics: ["Sleep", "Resting heart rate"], start: "2026-11-01", end: "2026-12-13",
    destination: "separate", host: "research.example.org", retention: "One year after the study ends" },
  { id: "gym", name: "Everyday Strength", organizer: "Example Community Gym",
    purpose: "Share your activity with your coach between classes.", metrics: ["Steps", "Workouts"],
    start: "", end: "", destination: "separate", host: "gym.example.org", retention: "30 days after you leave" },
];

export type MembershipPreview = { group: GroupPreview; enabled: string[] };

export function setMetric(membership: MembershipPreview, metric: string, enabled: boolean): MembershipPreview {
  if (!membership.group.metrics.includes(metric)) return membership;
  return { ...membership, enabled: enabled
    ? [...new Set([...membership.enabled, metric])]
    : membership.enabled.filter(item => item !== metric) };
}

export function previewInvite(code: string): GroupPreview | undefined {
  return PREVIEW_GROUPS.find(group => group.id === code);
}

export function dateLabel(day: string, fallback: string): string {
  return day ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }) : fallback;
}

export function validDraft(group: GroupPreview): boolean {
  return Boolean(group.name.trim() && group.organizer.trim() && group.purpose.trim()
    && group.metrics.length && group.retention.trim()
    && (!group.start || !group.end || group.start <= group.end)
    && (group.destination !== "separate" || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(group.host)));
}
