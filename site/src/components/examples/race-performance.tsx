import type { Report } from "@/lib/example-report";
import { number } from "./report-visuals";
import styles from "./examples.module.css";

const clock = (seconds: number) => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const pace = (minutes: number) => {
  const s = Math.round(minutes * 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function RacePerformance({
  race,
  longest,
  unit,
}: {
  race: NonNullable<Report["race"]>;
  longest: number | null;
  unit: "km" | "mi";
}) {
  const factor = unit === "mi" ? 0.621371192 : 1;
  const distance = race.km === null ? null : race.km * factor;
  const m = race.metrics;
  const metrics = [
    { value: m?.heartRate, label: "average heart rate", suffix: "bpm" },
    { value: m?.powerW, label: "average running power", suffix: "W" },
    { value: m?.steps, label: "recorded steps", suffix: "" },
    { value: m?.activeKcal, label: "active energy", suffix: "kcal" },
    {
      value:
        m?.strideM === undefined
          ? undefined
          : m.strideM * (unit === "mi" ? 3.280839895 : 1),
      label: "average stride length",
      suffix: unit === "mi" ? "ft" : "m",
      digits: 2,
    },
    {
      value: m?.groundContactMs,
      label: "average ground contact",
      suffix: "ms",
    },
    {
      value:
        m?.verticalCm === undefined
          ? undefined
          : m.verticalCm / (unit === "mi" ? 2.54 : 1),
      label: "average vertical oscillation",
      suffix: unit === "mi" ? "in" : "cm",
      digits: 1,
    },
    {
      value:
        m?.steps === undefined || race.minutes <= 0
          ? undefined
          : m.steps / race.minutes,
      label: "steps per recorded minute",
      suffix: "spm",
    },
  ].filter((metric) => metric.value !== undefined);
  return (
    <section className={styles.racePerformance}>
      <div className={styles.raceFinish}>
        <div>
          <span className={styles.micro}>Marathon day</span>
          <h2>{clock(race.minutes * 60)}</h2>
          <p>Recorded workout duration</p>
          <div className={styles.racePace}>
            <strong>
              {distance && distance > 0 ? pace(race.minutes / distance) : "—"}
            </strong>
            <span>average min/{unit}</span>
          </div>
        </div>
        <svg
          viewBox="0 0 300 300"
          role="img"
          aria-label={`${number(distance, 2)} recorded ${unit}`}
        >
          <circle
            cx="150"
            cy="150"
            r="124"
            fill="none"
            stroke="#2d4358"
            strokeWidth="12"
          />
          <circle
            cx="150"
            cy="150"
            r="124"
            fill="none"
            stroke="#f5c985"
            strokeWidth="12"
            strokeDasharray="760 20"
            transform="rotate(-90 150 150)"
            strokeLinecap="round"
          />
          {Array.from({ length: 26 }, (_, i) => (
            <line
              key={i}
              x1="150"
              y1="13"
              x2="150"
              y2="19"
              stroke="#7990a5"
              transform={`rotate(${(i * 360) / 26} 150 150)`}
            />
          ))}
          <text
            x="150"
            y="150"
            textAnchor="middle"
            fill="#f5c985"
            fontSize="54"
            fontWeight="600"
          >
            {number(distance, 2)}
          </text>
          <text
            x="150"
            y="181"
            textAnchor="middle"
            fill="#a9bdd2"
            fontSize="15"
          >
            recorded {unit}
          </text>
          <text
            x="150"
            y="216"
            textAnchor="middle"
            fill="#eef4fc"
            fontSize="12"
            letterSpacing="4"
          >
            FINISH
          </text>
        </svg>
      </div>
      {metrics.length > 0 && (
        <div className={styles.raceMetrics}>
          {metrics.map((metric) => (
            <div key={metric.label}>
              <strong>
                {number(metric.value!, metric.digits ?? 0)}{" "}
                <small>{metric.suffix}</small>
              </strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>
      )}
      {race.km !== null && race.km > 0 && longest !== null && longest > 0 && (
        <div className={styles.raceComparison}>
          <h3>Beyond the longest training run</h3>
          {[
            { label: "Longest training run", km: longest, color: "#74c9ff" },
            { label: "Marathon day", km: race.km, color: "#f5c985" },
          ].map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong>
                {number(row.km * factor, 1)} {unit}
              </strong>
              <i
                style={{
                  width: `${(row.km / Math.max(race.km!, longest)) * 100}%`,
                  background: row.color,
                }}
              />
            </div>
          ))}
        </div>
      )}
      <p className={styles.micro}>
        Watch-recorded workout measurements. Pace uses recorded distance and
        duration.
      </p>
    </section>
  );
}
