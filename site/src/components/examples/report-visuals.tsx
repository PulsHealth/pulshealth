import { forwardRef } from "react";
import { ACTIVITY_COLORS } from "@/lib/example-data";
import { monthlyHealth, yearMetrics, type Report } from "@/lib/example-report";
import styles from "./examples.module.css";
export const number = (n: number | null, digits = 0) =>
  n === null
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: digits });
export const hours = (minutes: number | null) =>
  minutes === null
    ? "—"
    : `${Math.floor(Math.round(minutes) / 60)}h ${Math.round(minutes) % 60}m`;
export const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(Math.floor(minutes % 60)).padStart(2, "0")}`;
export function MonthBars({
  values,
  label,
  color = "#68c7ff",
  height = 190,
}: {
  values: (number | null)[];
  label: string;
  color?: string;
  height?: number;
}) {
  const max = Math.max(1, ...values.filter((v): v is number => v !== null));
  return (
    <svg viewBox={`0 0 720 ${height + 50}`} role="img" aria-label={label}>
      <title>{label}</title>
      <text x="30" y="19" fill="#a9bdd2" fontSize="13">
        {label}
      </text>
      {values.map((v, i) => (
        <g key={i}>
          {v !== null ? (
            <rect
              x={32 + i * 56}
              y={height - (v / max) * (height - 42)}
              width="32"
              height={(v / max) * (height - 42)}
              fill={color}
              rx="3"
            >
              <title>
                {
                  [
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
                  ][i]
                }
                : {number(v, 1)}
              </title>
            </rect>
          ) : (
            <text
              x={48 + i * 56}
              y={height - 5}
              fill="#9baec3"
              textAnchor="middle"
            >
              —
            </text>
          )}
          <text
            x={48 + i * 56}
            y={height + 24}
            fill="#a9bdd2"
            fontSize="12"
            textAnchor="middle"
          >
            {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i]}
          </text>
        </g>
      ))}
    </svg>
  );
}
export function Trend({
  values,
  label,
  color = "#d7b8ff",
}: {
  values: (number | null)[];
  label: string;
  color?: string;
}) {
  const known = values.filter((v): v is number => v !== null),
    low = known.length ? Math.floor(Math.min(...known) * 0.9) : 0,
    high = known.length ? Math.ceil(Math.max(...known) * 1.1) : 1;
  return (
    <svg viewBox="0 0 720 210" role="img" aria-label={label}>
      <title>{label}</title>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line
            x1="50"
            x2="700"
            y1={160 - t * 110}
            y2={160 - t * 110}
            stroke="#2a3e55"
          />
          <text
            x="40"
            y={164 - t * 110}
            textAnchor="end"
            fontSize="12"
            fill="#a9bdd2"
          >
            {number(low + (high - low) * t, 1)}
          </text>
        </g>
      ))}
      <text x="50" y="23" fill="#a9bdd2" fontSize="13">
        {label}
      </text>
      {values.map((v, i) =>
        v === null ? null : (
          <g key={i}>
            {i > 0 && values[i - 1] !== null && (
              <line
                x1={65 + (i - 1) * 56}
                x2={65 + i * 56}
                y1={160 - ((values[i - 1]! - low) / (high - low || 1)) * 110}
                y2={160 - ((v - low) / (high - low || 1)) * 110}
                stroke={color}
                strokeWidth="3"
              />
            )}
            <circle
              cx={65 + i * 56}
              cy={160 - ((v - low) / (high - low || 1)) * 110}
              r="5"
              fill={color}
            >
              <title>{number(v, 1)}</title>
            </circle>
            <text
              x={65 + i * 56}
              y="190"
              fill="#a9bdd2"
              fontSize="12"
              textAnchor="middle"
            >
              {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i]}
            </text>
          </g>
        ),
      )}
    </svg>
  );
}
export const YearPoster = forwardRef<
  SVGSVGElement,
  {
    report: Report;
    format: "portrait" | "square" | "story";
    theme: "night" | "paper";
  }
>(function YearPoster({ report, format, theme }, ref) {
  const metrics = yearMetrics(report),
    paper = theme === "paper",
    bg = paper ? "#eef2f6" : "#101d2e",
    fg = paper ? "#162b42" : "#f2f6ff",
    muted = paper ? "#50677f" : "#a5bbd1",
    blue = paper ? "#176cb3" : "#74c9ff",
    purple = paper ? "#7155a8" : "#c9b7f5",
    amber = paper ? "#9a6328" : "#f5c985";
  const h = format === "story" ? 1920 : format === "square" ? 1080 : 1350;
  const stats = [
    {
      value: number(metrics.steps),
      label: "recorded steps",
      note: `${metrics.stepDays} days`,
      color: blue,
    },
    {
      value: hours(metrics.sleepMinutes),
      label: "average sleep",
      note: `${metrics.sleepDays} nights`,
      color: purple,
    },
    {
      value: number(report.totals.workouts),
      label: "workouts",
      note: `${report.totals.activeDays} days`,
      color: amber,
    },
    {
      value: number(report.totals.hours),
      label: "workout hours",
      note: `${report.sports.length} activities`,
      color: amber,
    },
    {
      value: number(metrics.restingHR, 1),
      label: "resting heart rate",
      note: `bpm · ${metrics.heartDays} days`,
      color: purple,
    },
    {
      value: number(metrics.tenKDays),
      label: "10,000-step days",
      note: `of ${metrics.stepDays} recorded`,
      color: blue,
    },
  ];
  const baseline = format === "square" ? 950 : 1000;
  const monthMax = Math.max(1, ...report.months.map((m) => m.hours));
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 1080 ${h}`}
      role="img"
      aria-label={`${report.year} health year in review: steps, sleep, workouts and heart trends`}
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      <title>My {report.year} in health</title>
      <rect width="1080" height={h} fill={bg} />
      <text x="72" y="100" fill={muted} fontSize="25">
        My year in health
      </text>
      <text
        x="60"
        y="304"
        fill={fg}
        fontSize="224"
        letterSpacing="-16"
        fontWeight="700"
      >
        {report.year}
      </text>
      <text x="74" y="355" fill={muted} fontSize="30">
        The miles. The quiet nights. The everyday effort.
      </text>
      {stats.map((s, i) => {
        const x = 74 + (i % 3) * 320,
          y = 460 + Math.floor(i / 3) * 170;
        return (
          <g key={s.label}>
            <text
              x={x}
              y={y}
              fill={s.color}
              fontSize={s.value.length > 7 ? 44 : 54}
              fontWeight="600"
            >
              {s.value}
            </text>
            <text x={x} y={y + 41} fill={fg} fontSize="24">
              {s.label}
            </text>
            <text x={x} y={y + 74} fill={muted} fontSize="20">
              {s.note}
            </text>
          </g>
        );
      })}
      <text x="74" y={format === "square" ? 780 : 823} fill={fg} fontSize="28">
        A year of showing up
      </text>
      <text
        x="74"
        y={format === "square" ? 814 : 857}
        fill={muted}
        fontSize="20"
      >
        Recorded workout hours, month by month
      </text>
      {report.months.map((m, i) => (
        <g key={m.label}>
          <rect
            x={77 + i * 78}
            y={baseline - (m.hours / monthMax) * 110}
            width="43"
            height={(m.hours / monthMax) * 110}
            fill={blue}
            rx="4"
          />
          <text
            x={98 + i * 78}
            y={baseline + 32}
            textAnchor="middle"
            fill={muted}
            fontSize="19"
          >
            {m.label[0]}
          </text>
        </g>
      ))}
      {format !== "square" && (
        <>
          <line
            x1="74"
            x2="1006"
            y1="1080"
            y2="1080"
            stroke={paper ? "#bdcbd9" : "#30465e"}
          />
          <text x="74" y="1133" fill={fg} fontSize="27">
            {report.sports
              .slice(0, 3)
              .map((s) => s.name)
              .join(" / ")}
          </text>
          <text x="74" y="1178" fill={muted} fontSize="24">
            {number(report.totals.km * 0.621371192)} recorded workout miles
          </text>
          <text x="74" y="1220" fill={muted} fontSize="22">
            {number(metrics.eightHours)} nights with 8+ hours of recorded sleep
          </text>
        </>
      )}
      {format === "story" && (
        <>
          <text x="74" y="1340" fill={fg} fontSize="32">
            Small days add up.
          </text>
          <text x="74" y="1385" fill={muted} fontSize="24">
            Daily steps across the year
          </text>
          {report.days.map((d, i) => (
            <rect
              key={i}
              x={76 + Math.floor(i / 7) * 17.3}
              y={1430 + (i % 7) * 27}
              width="13"
              height="22"
              rx="3"
              fill={d.steps === null ? muted : blue}
              opacity={
                d.steps === null
                  ? 0.12
                  : 0.18 + Math.min(d.steps / 15000, 1) * 0.82
              }
            />
          ))}
          <text x="74" y="1700" fill={purple} fontSize="48">
            {number(metrics.hrv, 1)} ms
          </text>
          <text x="74" y="1744" fill={muted} fontSize="25">
            Average daily HRV (SDNN)
          </text>
        </>
      )}
      <text x="74" y={h - 42} fill={muted} fontSize="18">
        Made with PulsHealth · Recorded data; coverage varies by metric
      </text>
    </svg>
  );
});
export function ActivityHeatmap({
  report,
  metric = "steps",
}: {
  report: Report;
  metric?: "steps" | "workouts";
}) {
  const values = report.days.map((d) =>
      metric === "steps" ? d.steps : d.workouts,
    ),
    max = metric === "steps" ? 15000 : 3;
  return (
    <div className={styles.heatmap}>
      <svg
        viewBox="0 0 740 154"
        role="img"
        aria-label={
          metric === "steps"
            ? "Daily recorded steps across the year; brighter cells mean more steps, empty cells mean missing data"
            : "Recorded workouts by day across the year"
        }
      >
        <title>
          Daily {metric} through {report.year}
        </title>
        {values.map((v, i) => (
          <rect
            key={i}
            x={28 + Math.floor(i / 7) * 13.1}
            y={25 + (i % 7) * 14}
            width="10"
            height="11"
            rx="2"
            fill={v === null ? "#52677f" : "#74c9ff"}
            opacity={v === null ? 0.16 : 0.12 + Math.min(v / max, 1) * 0.88}
          >
            <title>
              Day {i + 1}: {v === null ? "no data" : `${number(v)} ${metric}`}
            </title>
          </rect>
        ))}
        {report.months.map((m, i) => (
          <text
            key={m.label}
            x={28 + i * 57}
            y="140"
            fill="#a9bdd2"
            fontSize="11"
          >
            {m.label}
          </text>
        ))}
      </svg>
      <span>
        Less <i /> More · Missing days stay empty
      </span>
    </div>
  );
}
export function ActivityMix({ report }: { report: Report }) {
  const max = Math.max(1, ...report.sports.map((s) => s.hours));
  return (
    <div className={styles.sportList}>
      {report.sports
        .filter((s) => s.hours > 0)
        .map((s, i) => (
          <div key={s.name}>
            <div>
              <strong>{s.name}</strong>
              <span>
                {number(s.hours, 1)} h · {s.count} workouts
              </span>
            </div>
            <i
              style={{
                width: `${(s.hours / max) * 100}%`,
                background: Object.values(ACTIVITY_COLORS)[i % 4],
              }}
            />
          </div>
        ))}
    </div>
  );
}
export function SleepSummary({ report }: { report: Report }) {
  const m = yearMetrics(report),
    values = monthlyHealth(report, "sleepMinutes").map((v) =>
      v === null ? null : v / 60,
    );
  return (
    <>
      <div className={styles.sectionStats}>
        <div>
          <strong>{hours(m.sleepMinutes)}</strong>
          <span>average main sleep</span>
        </div>
        <div>
          <strong>{m.eightHours}</strong>
          <span>nights with 8+ hours</span>
        </div>
        <div>
          <strong>{m.sleepDays}</strong>
          <span>nights recorded</span>
        </div>
      </div>
      <Trend
        values={values}
        label="Average main sleep by month (hours)"
        color="#c9b7f5"
      />
    </>
  );
}
export function HeartSummary({ report }: { report: Report }) {
  const metrics = yearMetrics(report);
  return (
    <>
      <div className={styles.sectionStats}>
        <div>
          <strong>
            {number(metrics.restingHR, 1)}
            <small> bpm</small>
          </strong>
          <span>mean daily resting heart rate</span>
        </div>
        <div>
          <strong>
            {number(metrics.hrv, 1)}
            <small> ms</small>
          </strong>
          <span>mean daily HRV (SDNN)</span>
        </div>
      </div>
      <Trend
        values={monthlyHealth(report, "restingHR")}
        label="Mean daily resting heart rate by month (bpm)"
        color="#f5c985"
      />
      <Trend
        values={monthlyHealth(report, "hrv")}
        label="Mean daily HRV by month (ms)"
        color="#c9b7f5"
      />
    </>
  );
}
export function WeekChart({
  report,
  selected,
  onSelect,
  unit = "km",
}: {
  report: Report;
  selected: number;
  onSelect?: (week: number) => void;
  unit?: "km" | "mi";
}) {
  const max = Math.max(1, ...report.weeks.map((w) => w.km));
  return (
    <svg
      width="720"
      height="310"
      viewBox="0 0 720 310"
      role="img"
      aria-label={`Sixteen weeks of recorded running distance and longest run, in ${unit}`}
    >
      <title>Weekly training distance and longest run ({unit})</title>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line
            x1="42"
            x2="709"
            y1={250 - t * 190}
            y2={250 - t * 190}
            stroke="#2a3e55"
          />
          <text
            x="33"
            y={254 - t * 190}
            textAnchor="end"
            fill="#a9bdd2"
            fontSize="12"
          >
            {number(t * max)}
          </text>
        </g>
      ))}
      {report.weeks.map((w, i) => (
        <g key={i}>
          <rect
            x={50 + i * 41}
            y={250 - (w.km / max) * 190}
            width="25"
            height={(w.km / max) * 190}
            rx="3"
            fill={i === selected ? "#eff8ff" : "#74c9ff"}
            onClick={() => onSelect?.(i)}
          >
            <title>
              Week {i + 1}: {number(w.km, 1)} {unit}, {w.count} runs
            </title>
          </rect>
          {w.longest !== null && (
            <line
              x1={47 + i * 41}
              x2={78 + i * 41}
              y1={250 - (w.longest / max) * 190}
              y2={250 - (w.longest / max) * 190}
              stroke="#f5c985"
              strokeWidth="3"
            />
          )}
          {w.count === 0 && (
            <text x={62 + i * 41} y="240" fill="#a9bdd2" textAnchor="middle">
              ×
            </text>
          )}
          <text
            x={62 + i * 41}
            y="277"
            fill="#a9bdd2"
            textAnchor="middle"
            fontSize="11"
          >
            {i + 1}
          </text>
        </g>
      ))}
      <text x="42" y="26" fill="#a9bdd2" fontSize="13">
        Distance ({unit})
      </text>
      <text x="380" y="303" fill="#a9bdd2" textAnchor="middle" fontSize="13">
        Training week
      </text>
    </svg>
  );
}
export const MarathonPoster = forwardRef<
  SVGSVGElement,
  { report: Report; unit?: "km" | "mi" }
>(function MarathonPoster({ report, unit = "mi" }, ref) {
  const factor = unit === "mi" ? 0.621371192 : 1;
  const total = report.weeks.reduce((n, w) => n + w.km, 0),
    peak = Math.max(0, ...report.weeks.map((w) => w.km)),
    knownLongest = report.weeks.flatMap((w) =>
      w.longest === null ? [] : [w.longest],
    ),
    longest = knownLongest.length ? Math.max(...knownLongest) : null;
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1080 1350"
      role="img"
      aria-label="Marathon training summary poster"
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      <rect width="1080" height="1350" fill="#101d2e" />
      <text x="72" y="100" fill="#a5bbd1" fontSize="25">
        The road to race day
      </text>
      <text x="62" y="290" fill="#f2f6ff" fontWeight="700" fontSize="180">
        16 weeks.
      </text>
      <text x="74" y="370" fill="#74c9ff" fontSize="64">
        to marathon day.
      </text>
      {[
        { v: report.runs.length, l: "recorded training runs" },
        {
          v: number(longest === null ? null : longest * factor, 1),
          l: `${unit} · longest run`,
        },
        { v: number(peak * factor, 1), l: `${unit} · peak week` },
      ].map((x, i) => (
        <g key={i}>
          <text
            x={74 + i * 320}
            y="530"
            fill={i === 1 ? "#f5c985" : "#eff6ff"}
            fontSize="65"
          >
            {x.v}
          </text>
          <text x={74 + i * 320} y="576" fill="#a5bbd1" fontSize="22">
            {x.l}
          </text>
        </g>
      ))}
      <g transform="translate(30 660) scale(1.42)">
        <WeekChart
          report={{
            ...report,
            weeks: report.weeks.map((w) => ({
              ...w,
              km: w.km * factor,
              longest: w.longest === null ? null : w.longest * factor,
            })),
          }}
          selected={-1}
          unit={unit}
        />
      </g>
      {report.race ? <>
        <text x="74" y="1170" fill="#f5c985" fontSize="40">
          {Math.floor(report.race.minutes / 60)}:{String(Math.floor(report.race.minutes % 60)).padStart(2,"0")}:{String(Math.round(report.race.minutes * 60) % 60).padStart(2,"0")} · race workout time
        </text>
        <text x="74" y="1220" fill="#eef4fc" fontSize="27">
          {number(report.race.km === null ? null : report.race.km * factor,2)} recorded {unit} · {number(total * factor)} {unit} of training
        </text>
        <text x="74" y="1260" fill="#a5bbd1" fontSize="22">
          {report.race.metrics?.heartRate !== undefined ? `${number(report.race.metrics.heartRate)} bpm average heart rate` : "Watch-recorded duration and distance"}
          {report.race.metrics?.powerW !== undefined ? ` · ${number(report.race.metrics.powerW)} W average power` : ""}
        </text>
      </> : <>
        <text x="74" y="1180" fill="#a5bbd1" fontSize="25">{number(total * factor)} {unit} of training · Gold marks the longest run</text>
        <text x="74" y="1230" fill="#a5bbd1" fontSize="22">No race selected; totals may include the race.</text>
      </>}
      <text x="74" y="1305" fill="#a5bbd1" fontSize="18">
        Made with PulsHealth
      </text>
    </svg>
  );
});
