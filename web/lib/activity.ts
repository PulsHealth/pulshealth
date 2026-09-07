// Pretty-print a workout activity type. Live data stores stable wire strings
// ("running", "strength_training", "hiit"); demo data already uses display
// names ("Running"). Both normalize cleanly here.

const SPECIAL: Record<string, string> = {
  hiit: "HIIT",
  triathlon: "Triathlon",
  tai_chi: "Tai Chi",
  disc_sports: "Disc Sports",
  paddle_sports: "Paddle Sports",
  snow_sports: "Snow Sports",
  wheelchair_walk: "Wheelchair (Walk Pace)",
  wheelchair_run: "Wheelchair (Run Pace)",
  hand_cycling: "Hand Cycling",
};

export function formatActivity(raw: string | null | undefined): string {
  if (!raw) return "Workout";
  const key = raw.toLowerCase();
  if (SPECIAL[key]) return SPECIAL[key];
  return raw
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
