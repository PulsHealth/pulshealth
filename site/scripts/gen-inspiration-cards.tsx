import { SLEEP_COLORS, type SleepStage } from "../src/lib/sleep-report";
/** Render public link-preview cards from the same display-only data as the demos. */
import { ImageResponse } from "next/og";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sensorRecorded from "../src/lib/sensor-recorded.json";
import sleepRecorded from "../src/lib/sleep-recorded.json";
import recorded from "../src/lib/example-recorded.json";
import { EXAMPLES } from "../src/lib/examples";
const fontDir =
  process.env.SOCIAL_CARD_FONT_DIR ?? "/System/Library/Fonts/Supplemental";
const fonts = await Promise.all(
  ([400, 700] as const).map(async (weight) => ({
    name: "Arial",
    data: await readFile(
      join(fontDir, weight === 400 ? "Arial.ttf" : "Arial Bold.ttf"),
    ),
    weight,
    style: "normal" as const,
  })),
);
const out = new URL("../public/inspiration-cards/", import.meta.url);
await mkdir(out, { recursive: true });
for (const example of [{ slug: "index", title: "Inspiration" }, ...EXAMPLES]) {
  const routes =
    example.slug === "heart-rate-sensors"
      ? sensorRecorded.recordings.map((run) =>
          run.points
            .map(
              (p, i) =>
                `${i ? "L" : "M"}${50 + (p.seconds / 3200) * 620},${360 - (p.value / 200) * 300}`,
            )
            .join(" "),
        )
      : example.slug === "deep-workout-analysis"
        ? recorded.routeComparisons[0].attempts.map((run) => run.path)
        : recorded.routes.slice(0, 100).map((route) => route.path);
  const totalMiles = Math.round(
    recorded.totals.km * 0.621371192,
  ).toLocaleString("en-US");
  const subtitle =
    example.slug === "heart-rate-sensors"
      ? "Recording cadence, density and gaps"
      : example.slug === "sleep-and-parenthood"
        ? "Sleep stages, awakenings and nightly duration"
        : example.slug === "year-in-review"
          ? `${recorded.totals.workouts} workouts · ${totalMiles} miles`
          : example.slug === "marathon-training"
            ? "16 weeks to marathon day"
            : example.slug === "deep-workout-analysis"
              ? `${recorded.routeComparisons[0].attempts.length} runs. One familiar route.`
              : example.slug === "activity-art"
                ? "Made from real movement"
                : example.slug === "activity-atlas"
                  ? "Walks. Runs. Rides."
                  : "What could you build with your health data?";
  const response = new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#101d2e",
        fontFamily: "Arial",
        color: "#eef4fc",
        padding: 60,
        alignItems: "center",
        gap: 35,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 570,
          gap: 24,
        }}
      >
        <span style={{ fontSize: 23, color: "#a9bdd2" }}>
          PULSHEALTH · INSPIRATION
        </span>
        <span
          style={{
            fontSize: 72,
            lineHeight: 1.04,
            fontWeight: 700,
            letterSpacing: -3,
          }}
        >
          {example.title}
        </span>
        <span style={{ fontSize: 28, color: "#74c9ff", lineHeight: 1.3 }}>
          {subtitle}
        </span>
      </div>
      <svg width="470" height="450" viewBox="0 0 720 420">
        {example.slug === "sleep-and-parenthood"
          ? sleepRecorded.milestones[0].days
              .filter((day) => day.offset >= -14 && day.offset < 14)
              .map((day) => (
                <g key={day.offset}>
                  <rect
                    x="20"
                    y={(day.offset + 14) * 14}
                    width="680"
                    height="10"
                    fill="#223449"
                  />
                  {(day.segments ?? []).map((segment, i) => (
                    <rect
                      key={i}
                      x={20 + (segment.start / 720) * 680}
                      y={(day.offset + 14) * 14}
                      width={((segment.end - segment.start) / 720) * 680}
                      height="10"
                      fill={SLEEP_COLORS[segment.stage as SleepStage]}
                    />
                  ))}
                </g>
              ))
          : routes.map((path, i) => (
              <path
                key={i}
                d={path}
                fill="none"
                stroke={["#74c9ff", "#d7b8ff", "#f5c985"][i % 3]}
                strokeWidth={example.slug === "deep-workout-analysis" ? 2 : 1.4}
                opacity={example.slug === "deep-workout-analysis" ? 0.8 : 0.5}
              />
            ))}
      </svg>
    </div>,
    { width: 1200, height: 630, fonts },
  );
  await writeFile(
    new URL(`${example.slug}.png`, out),
    Buffer.from(await response.arrayBuffer()),
  );
}
console.log("Generated Inspiration link-preview cards.");
