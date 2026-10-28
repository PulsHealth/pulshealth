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
    slug: "deep-workout-analysis",
    title: "Deep workout analysis",
    intro: "Same route. A different run.",
    description: "Compare repeated runs on geographically matched routes.",
    input: "Workouts and routes",
    action: "Compare runs",
    prompt:
      "Find repeated running routes in my PulsHealth data using geographic overlap, direction, start/end proximity and similar distance. Compare recorded time, pace and available heart rate or power across attempts. Show route overlays so I can inspect matches. Keep absent metrics missing and do not infer fitness gains or causes from faster times alone.",
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

  {
    slug: "sleep-and-parenthood",
    title: "Sleep through new chapters",
    intro: "Sleep before and after becoming a parent.",
    description: "Sleep stages, nightly duration, and recorded awakenings before and after a new arrival.",
    input: "Sleep sessions and private milestone dates",
    action: "Compare sleep",
    prompt:
      "Compare my recorded sleep before and after one family milestone using my PulsHealth sleep sessions. Use the longest positive session per wake-up day. Show source-consistent sleep stage timelines, short comparison windows, nightly duration, recorded awake-episode counts and duration, longest continuous sleep and missing-night coverage. Align timelines on day zero and keep calendar dates and identifying details private in public outputs. Describe associations without claiming parenthood caused the changes. Create a shareable image.",
  },
  {
    slug: "heart-rate-sensors",
    title: "Watch vs external heart rate",
    intro: "Find what the recordings actually show.",
    description: "Compare heart-rate sampling cadence, density and gaps across Watch and Bluetooth recordings.",
    input: "Expanded workout heart-rate streams and source audit",
    action: "Compare recordings",
    prompt: "Audit my PulsHealth heart-rate sources to find external sensor recordings and any simultaneous Apple Watch data. Compare expanded workout streams, not raw HealthKit quantity object counts. Show interval distributions, readings per minute and gaps. If recordings are from different runs, state that clearly and do not infer sensor accuracy or heart-rate agreement. Keep dates, source identifiers and personal attribution private in public output.",
  },
] as const;
export type ExampleSlug = (typeof EXAMPLES)[number]["slug"];
