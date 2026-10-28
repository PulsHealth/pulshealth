"use client";
import { useRef, useState } from "react";
import {
  heartbeatPoints,
  listeningDays,
  moments,
  MONTHS,
} from "@/lib/listening-heartbeats";
import { exportImage } from "./export-image";
import shared from "./examples.module.css";
import styles from "./listening-heartbeats.module.css";
const ink = "#eef4fc",
  muted = "#a9bdd2",
  pink = "#f19cb8",
  blue = "#74c9ff";
const soundColor = (level: number | null) =>
  level === null
    ? "#26384d"
    : level < 68
      ? "#739be0"
      : level < 78
        ? "#baa5ec"
        : "#f0b789";
export function ListeningHeartbeats({
  kind,
  compact = false,
}: {
  kind: "listening" | "heartbeats";
  compact?: boolean;
}) {
  const [month, setMonth] = useState(-1),
    [selectedDay, setSelectedDay] = useState(1),
    [moment, setMoment] = useState(3),
    [window, setWindow] = useState("day"),
    [status, setStatus] = useState("");
  const svg = useRef<SVGSVGElement>(null);
  const listening = kind === "listening";
  const days = listeningDays.filter((d) => month === -1 || d.month === month);
  const recorded = days.filter((d) => d.minutes !== null);
  const minutes = recorded.reduce((sum, d) => sum + d.minutes!, 0);
  const selected = listeningDays[selectedDay];
  const range =
    window === "morning" ? [5, 10] : window === "evening" ? [16, 23] : [0, 24];
  const points = heartbeatPoints.filter(
    (p) => p.hour >= range[0] && p.hour <= range[1],
  );
  const x = (hour: number) =>
    80 + ((hour - range[0]) / (range[1] - range[0])) * 840;
  const y = (bpm: number) => 650 - ((bpm - 40) / 120) * 300;
  const active = moments[moment];
  // Do not draw connections across intervals with more than 20 minutes between samples.
  const path = points
    .map(
      (p, i) =>
        `${!i || p.hour - points[i - 1].hour > 1 / 3 + 0.001 ? "M" : "L"}${x(p.hour).toFixed(1)},${y(p.bpm).toFixed(1)}`,
    )
    .join(" ");
  const artwork = (
    <svg
      ref={svg}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 850"
      role="img"
      aria-label={
        listening
          ? `Illustrative listening calendar, ${month < 0 ? "2025" : MONTHS[month]}. ${recorded.length} days with records.`
          : `Illustrative heart-rate readings from ${range[0]}:00 to ${range[1]}:00. Missing intervals are left blank.`
      }
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      <rect width="1000" height="850" fill="#101d2e" />
      <text x="70" y="75" fill={muted} fontSize="19">
        {listening
          ? "A listening diary / 2025"
          : "One day, in sampled heartbeats"}
      </text>
      <text x="70" y="157" fill={ink} fontSize="54" fontWeight="600">
        {listening ? "The soundtrack" : "Life between"}
      </text>
      <text x="70" y="219" fill={ink} fontSize="54" fontWeight="600">
        {listening ? "of your year." : "the readings."}
      </text>
      {listening ? (
        <>
          <text x="70" y="285" fill="#d6bcf2" fontSize="23">
            {Math.round(minutes / 60)} recorded hours · {recorded.length} days
            with records
          </text>
          {MONTHS.map((name, m) => (
            <g key={name} opacity={month < 0 || month === m ? 1 : 0.22}>
              <text x="70" y={337 + m * 31} fill={muted} fontSize="16">
                {name}
              </text>
              {listeningDays
                .filter((d) => d.month === m)
                .map((d, i) => (
                  <g key={d.day}>
                    <rect
                      x={135 + i * 24}
                      y={319 + m * 31}
                      width="18"
                      height="23"
                      rx="3"
                      fill={soundColor(d.level)}
                    />
                  </g>
                ))}
            </g>
          ))}
          {[
            ["#739be0", "58–67"],
            ["#baa5ec", "68–77"],
            ["#f0b789", "78–86"],
            ["#26384d", "No records"],
          ].map(([color, label], i) => (
            <g key={label}>
              <rect
                x={70 + i * 220}
                y="725"
                width="14"
                height="14"
                rx="3"
                fill={color}
              />
              <text x={94 + i * 220} y="739" fill={muted} fontSize="16">
                {label}
                {i < 3 ? " dB(A)" : ""}
              </text>
            </g>
          ))}
        </>
      ) : (
        <>
          <text x="70" y="280" fill={pink} fontSize="23">
            {active.time} / {active.title}
          </text>
          {[40, 80, 120, 160].map((value) => (
            <g key={value}>
              <line
                x1="80"
                x2="920"
                y1={y(value)}
                y2={y(value)}
                stroke="#2a3d53"
              />
              <text x="32" y={y(value) + 5} fill={muted} fontSize="15">
                {value}
              </text>
            </g>
          ))}
          <text x="80" y="329" fill={muted} fontSize="16">
            Heart rate / bpm
          </text>
          <path
            d={path}
            fill="none"
            stroke={pink}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <circle key={i} cx={x(p.hour)} cy={y(p.bpm)} r="2.8" fill={pink} />
          ))}
          {Array.from(
            { length: 5 },
            (_, i) => range[0] + ((range[1] - range[0]) * i) / 4,
          ).map((h) => (
            <text
              key={h}
              x={x(h)}
              y="687"
              textAnchor="middle"
              fill={muted}
              fontSize="16"
            >
              {String(Math.floor(h)).padStart(2, "0")}:
              {String(Math.round((h % 1) * 60)).padStart(2, "0")}
            </text>
          ))}
          {active.hour >= range[0] && active.hour <= range[1] && (
            <line
              x1={x(active.hour)}
              x2={x(active.hour)}
              y1="350"
              y2="650"
              stroke={blue}
              strokeDasharray="5 6"
            />
          )}
          <text x="80" y="737" fill={muted} fontSize="18">
            Dots are readings. Blank intervals have no samples.
          </text>
        </>
      )}
      <text x="70" y="802" fill={muted} fontSize="16">
        PulsHealth / Invented data for illustration
      </text>
    </svg>
  );
  if (compact) return artwork;
  return (
    <div className={shared.demo}>
      <div className={styles.toolbar}>
        <span className={styles.badge}>Illustrative data</span>
        {listening ? (
          <label>
            View{" "}
            <select
              value={month}
              onChange={(e) => {
                setMonth(Number(e.target.value));
                setSelectedDay(
                  listeningDays.find(
                    (d) =>
                      Number(e.target.value) < 0 ||
                      d.month === Number(e.target.value),
                  )!.day,
                );
              }}
            >
              <option value={-1}>Whole year</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            View{" "}
            <select
              value={window}
              onChange={(e) => {
                const value = e.target.value;
                setWindow(value);
                if (value === "morning") setMoment(1);
                if (value === "evening") setMoment(3);
              }}
            >
              <option value="day">Whole day</option>
              <option value="morning">Morning / 05–10</option>
              <option value="evening">Evening / 16–23</option>
            </select>
          </label>
        )}
        <button
          onClick={async () => {
            if (!svg.current) return;
            try {
              setStatus(
                await exportImage(
                  svg.current,
                  listening ? "listening-year" : "life-in-heartbeats",
                ),
              );
            } catch {
              setStatus("Could not export the image. Try again.");
            }
          }}
        >
          Save image
        </button>
        <span role="status">{status}</span>
      </div>
      <div className={styles.poster}>{artwork}</div>
      <p className={styles.note}>
        {listening
          ? "Sound levels in dB(A): blue 58–67; violet 68–77; peach 78–86. Dark tiles have no records. Each row is a month; each tile is a calendar day."
          : `Showing ${String(range[0]).padStart(2, "0")}:00–${String(range[1]).padStart(2, "0")}:00. The vertical scale runs from 40 to 160 bpm. Dots show individual readings; empty intervals stay blank.`}
      </p>
      {listening ? (
        <div className={styles.body}>
          <section>
            <h2>A year, one recorded day at a time</h2>
            <p>
              Pick a day to inspect its invented listening record. Color
              represents its sound level; a muted tile means no record, rather
              than confirmed silence.
            </p>
            <div className={styles.days}>
              {days.map((d) => (
                <button
                  key={d.day}
                  style={{
                    background: soundColor(d.level),
                    color: d.level === null ? "#eef4fc" : "#101d2e",
                  }}
                  aria-label={`${d.date}: ${d.minutes === null ? "no records" : `${d.minutes} recorded minutes at ${d.level} dB(A)`}`}
                  aria-pressed={selectedDay === d.day}
                  onClick={() => setSelectedDay(d.day)}
                >
                  {Number(d.date.slice(-2))}
                </button>
              ))}
            </div>
          </section>
          <section aria-live="polite">
            <h2>{selected.date}</h2>
            <p className={styles.dayDetail}>
              {selected.minutes === null
                ? "No headphone exposure record in this example. Listening time and sound level are unknown."
                : `${selected.minutes} recorded minutes at ${selected.level} dB(A). This invented day contains one constant-level interval.`}
            </p>
            <p>
              In a real export, records describe sound exposure, not the songs,
              podcasts, or artists you played.
            </p>
          </section>
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.moments} aria-label="Annotated moments">
            {moments.map((m, i) => (
              <button
                key={m.title}
                aria-pressed={moment === i}
                onClick={() => {
                  setMoment(i);
                  if (m.hour < range[0] || m.hour > range[1]) setWindow("day");
                }}
              >
                <time>{m.time}</time>
                {m.title}
              </button>
            ))}
          </div>
          <section aria-live="polite">
            <h2>{active.title}</h2>
            <p>{active.text}</p>
          </section>
        </div>
      )}
      <p className={styles.note}>
        {listening
          ? "How to make this: use headphone audio exposure intervals and their durations. Union overlapping intervals before counting time; show source coverage and missing days. If combining sound levels, use duration-weighted sound energy, not an arithmetic mean of decibels. The colors here group levels for display and are not safety ratings."
          : "How to make this: use timestamped heart-rate samples, workout times, sleep intervals, and optional notes you add yourself. Keep source differences and sampling gaps visible. These dots are invented heart-rate readings, not an ECG waveform or a count of every heartbeat. An annotation provides context; it does not establish a cause."}
      </p>
    </div>
  );
}
