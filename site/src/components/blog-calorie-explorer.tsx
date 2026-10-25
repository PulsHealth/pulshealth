"use client";

import { useId, useState } from "react";
import { calorieBreakdown, initialCalories } from "@/lib/calorie-accounting";

const format = (value: number) => value.toLocaleString("en-US");

export function CalorieExplorer() {
  const id = useId();
  const [inputs, setInputs] = useState(initialCalories);
  const values = calorieBreakdown(inputs);
  const { resting, active, workout, otherActive, total } = values;
  const controls = [
    { key: "resting" as const, label: "Daily resting energy", value: resting, min: 800, max: 3000 },
    { key: "active" as const, label: "Daily active energy", value: active, min: 0, max: 2000 },
    { key: "workout" as const, label: "Of that active energy, recorded in workouts", value: workout, min: 0, max: active },
  ];

  return (
    <figure className="not-prose my-10 rounded-2xl border border-border bg-muted/20 p-5 text-foreground sm:p-7" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-xl font-semibold leading-snug">Where do the workout calories go?</h3>
      <p id={`${id}-description`} className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Try changing the workout share. It divides the day’s active energy; it does not get added again to the total.
      </p>

      <div className="my-7" aria-hidden="true">
        <div className="mb-2 flex justify-between gap-3 text-sm font-medium">
          <span>One day</span>
          <span className="tabular-nums">{format(total)} kcal total</span>
        </div>
        <div className="flex h-14 overflow-hidden rounded-md bg-muted">
          <div className="h-full bg-slate-400 dark:bg-slate-500" style={{ width: `${resting / total * 100}%` }} />
          <div className="flex h-full border-2 border-brand" style={{ width: `${active / total * 100}%`, minWidth: active > 0 ? 4 : 0, borderWidth: active > 0 ? 2 : 0 }}>
            <div className="h-full bg-brand/20" style={{ width: `${active > 0 ? otherActive / active * 100 : 0}%` }} />
            <div className="h-full bg-brand" style={{ width: `${active > 0 ? workout / active * 100 : 0}%` }} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-slate-400 dark:bg-slate-500" />Resting</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-brand bg-brand/20" />Other active</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-brand" />Workout active</span>
        </div>
      </div>

      <div className="space-y-5" aria-describedby={`${id}-description`}>
        {controls.map(({ key, label, value, min, max }) => (
          <div key={key}>
            <div className="flex items-start justify-between gap-4 text-sm">
              <label htmlFor={`${id}-${key}`} className="font-medium leading-snug">{label}</label>
              <span className="shrink-0 tabular-nums">{format(value)} kcal</span>
            </div>
            <input
              id={`${id}-${key}`}
              type="range"
              min={min}
              max={max}
              step="25"
              value={value}
              disabled={key === "workout" && active === 0}
              aria-valuetext={`${format(value)} kilocalories`}
              aria-describedby={key === "workout" ? `${id}-workout-note` : undefined}
              onChange={(event) => {
                const next = calorieBreakdown({ ...inputs, [key]: Number(event.target.value) });
                setInputs({ resting: next.resting, active: next.active, workout: next.workout });
              }}
              className="mt-1 block h-8 w-full cursor-pointer accent-brand focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand disabled:cursor-default disabled:opacity-40"
            />
          </div>
        ))}
      </div>

      <div className="mt-5 border-t border-border pt-5" role="status" aria-live="polite" aria-atomic="true">
        <p className="text-base font-semibold tabular-nums">
          {format(resting)} resting + {format(active)} active = {format(total)} kcal
        </p>
        <p id={`${id}-workout-note`} className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {active === 0
            ? "With no active energy in this example, there is no workout share to allocate."
            : <>The {format(active)} active kcal already include {format(workout)} workout kcal and {format(otherActive)} other active kcal.</>}
          {" "}If you lower daily active energy below the workout share, the workout share comes down with it.
        </p>
      </div>
      <figcaption className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Illustrative accounting example, not personal data or a calorie recommendation. These sliders assume matching dates and consistent records. Changing the workout share reallocates a fixed active total; doing additional exercise in real life can change that total.
      </figcaption>
      <noscript><p className="mt-3 text-sm text-muted-foreground">This is the starting example. Enable JavaScript to change the values.</p></noscript>
    </figure>
  );
}
