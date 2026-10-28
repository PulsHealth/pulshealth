/** Deterministic, invented display data. No personal records or clinical model. */
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const listeningDays = Array.from({ length: 365 }, (_, day) => {
  const date = new Date(Date.UTC(2025, 0, day + 1));
  const recorded = day % 11 !== 0 && day % 17 !== 0;
  return {
    day,
    month: date.getUTCMonth(),
    date: date.toISOString().slice(0, 10),
    minutes: recorded ? 18 + ((day * 37) % 145) : null,
    level: recorded ? 58 + ((day * 13) % 29) : null,
  };
});
export const moments = [
  {
    hour: 2,
    title: "The quiet hours",
    time: "02:00",
    text: "A few readings through the night. The spaces between them stay empty.",
  },
  {
    hour: 7.5,
    title: "Out the door",
    time: "07:30",
    text: "An invented morning walk, annotated separately from the heart-rate readings.",
  },
  {
    hour: 12.5,
    title: "A lunchtime pause",
    time: "12:30",
    text: "A short walk breaks up the middle of the day.",
  },
  {
    hour: 18,
    title: "The evening run",
    time: "18:00",
    text: "More frequent readings during a fictional workout reveal a different shape.",
  },
  {
    hour: 22,
    title: "Winding down",
    time: "22:00",
    text: "The evening settles. A lower reading alone does not explain how someone felt.",
  },
];
export const heartbeatPoints = Array.from({ length: 288 }, (_, i) => {
  const hour = i / 12;
  // Two intentional gaps; daytime background readings are sparse.
  if (
    (hour > 9 && hour < 10.5) ||
    (hour > 15 && hour < 16) ||
    (hour < 17.5 && i % 3 !== 0)
  )
    return null;
  const base = hour < 6.5 ? 54 : hour < 17.5 ? 72 : hour < 19 ? 139 : 66;
  const walk =
    Math.abs(hour - 7.5) < 0.45 || Math.abs(hour - 12.5) < 0.4 ? 25 : 0;
  return {
    hour,
    bpm: Math.round(
      base + walk + Math.sin(i * 1.8) * 6 + Math.sin(i * 0.31) * 4,
    ),
  };
}).filter((p): p is { hour: number; bpm: number } => p !== null);
