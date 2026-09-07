import type { Group } from "./catalog";

// Apple-Health-inspired accent per group (dark-mode system color variants).
// One vivid hue per category keeps the monochrome Vercel base from going flat.
export const GROUP_COLOR: Record<Group, string> = {
  activity: "#ff453a", // red — Move
  heart: "#ff2d55", // pink-red
  body: "#bf5af2", // purple
  respiratory: "#64d2ff", // cyan
  sleep: "#5e5ce6", // indigo
  nutrition: "#ff9f0a", // amber
  vitals: "#ff6482", // rose
  workouts: "#30d158", // green
  other: "#98989f", // gray
};

// A soft second stop for gradient fills under area charts / ring tracks.
export const GROUP_COLOR_SOFT: Record<Group, string> = {
  activity: "#ff7a6e",
  heart: "#ff6a86",
  body: "#d68bf5",
  respiratory: "#9be0ff",
  sleep: "#8a89ee",
  nutrition: "#ffc15c",
  vitals: "#ff97aa",
  workouts: "#6fe08f",
  other: "#bcbcc2",
};

export function groupColor(g: Group): string {
  return GROUP_COLOR[g];
}
