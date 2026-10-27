export const EXAMPLES = [
  {
    slug: "year-in-review",
    title: "Your year in health",
    intro: "A year of movement, told in your own numbers.",
    description: "A shareable portrait of movement, sleep, and heart trends.",
    input: "Workout export",
    action: "Explore a year",
    prompt:
      "Build a shareable health year in review from my PulsHealth exports, including daily steps, sleep, exercise, resting heart rate, HRV, and workouts where available. Offer portrait, square, and story PNG exports. Use the reporting time zone I choose. Count unique workout UUIDs, show monthly distance by activity and recorded workout time, and call out missing distances. Keep the narrative traceable to the underlying records. Do not infer why my routine changed.",
  },
  {
    slug: "marathon-training",
    title: "The road to race day",
    intro: "See the training behind the finish line.",
    description: "Sixteen weeks of effort, all the way to race day.",
    input: "Workout export + race date",
    action: "Explore the training",
    prompt:
      "Analyze the 16 weeks ending on my selected race date from my PulsHealth workouts. Keep the race workout separate using its UUID. Show weekly recorded running distance, longest run, and run count. Preserve weeks with no records and distinguish them from confirmed rest. Describe the history without treating it as a training prescription.",
  },
  {
    slug: "activity-art",
    title: "Activity as art",
    intro: "Your movement makes its own signature.",
    description: "Familiar paths, made into something worth keeping.",
    input: "Workout routes",
    action: "Make some art",
    prompt:
      "Help me turn my PulsHealth workout routes into SVG artwork locally. Offer a route collection with each route fitted to its own tile and a composition with routes layered in one shared geographic projection. Preserve aspect ratio, handle stationary tracks, and keep coordinates out of filenames and labels. Explain that even abstract route shapes may reveal places.",
  },
  {
    slug: "activity-atlas",
    title: "Your activity atlas",
    intro: "All the places your feet and wheels have taken you.",
    description: "A year of walks, runs, and rides in one place.",
    input: "Workout routes",
    action: "Explore the atlas",
    prompt:
      "Create a local atlas from my PulsHealth workout routes. Use shared geographic bounds for all routes, correct longitude scale for latitude, preserve separate workout paths, and let me filter walking, running, cycling, and other activities. Show route coverage separately from total workouts. Do not send coordinates to map providers or upload my data.",
  },
] as const;
export type ExampleSlug = (typeof EXAMPLES)[number]["slug"];
