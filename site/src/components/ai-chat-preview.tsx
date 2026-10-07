import { Database, Sparkles } from "lucide-react";

/**
 * The home page's hero picture: an assistant answering from synced data.
 * An illustration with demo numbers, not a screenshot of any one product, so
 * it uses the site's own tokens rather than imitating a chat app's UI.
 */

/** Average nightly sleep per week, in hours. Hard training weeks are marked. */
const weeks = [
  { label: "Aug 4", hours: 7.3 },
  { label: "Aug 11", hours: 7.1 },
  { label: "Aug 18", hours: 6.6, hard: true },
  { label: "Aug 25", hours: 7.4 },
  { label: "Sep 1", hours: 6.8, hard: true },
  { label: "Sep 8", hours: 7.2 },
  { label: "Sep 15", hours: 6.5, hard: true },
  { label: "Sep 22", hours: 7.3 },
];

const MAX_HOURS = 8;

function formatHours(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h} h ${m.toString().padStart(2, "0")} m`;
}

export function AiChatPreview() {
  return (
    <figure className="mx-auto w-full max-w-lg">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-black/10 dark:shadow-black/40">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-brand" aria-hidden />
            Your AI assistant
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            PulsHealth connected
          </span>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm text-brand-foreground">
            Do I sleep less in my hard training weeks?
          </p>

          <div className="space-y-3 text-sm">
            <p className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              <Database className="h-3 w-3" aria-hidden />
              Read sleep and workouts, last 8 weeks
            </p>
            <p className="leading-relaxed text-pretty">
              Yes. In your three hardest training weeks you averaged{" "}
              <strong className="font-semibold">6 h 38 m</strong> of sleep a night,{" "}
              <strong className="font-semibold">38 minutes less</strong> than in the other weeks.
            </p>

            <div className="rounded-xl border bg-background p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Average sleep per night, by week</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[2px] bg-brand" aria-hidden />
                  Hard week
                </span>
              </div>
              <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="Average nightly sleep for eight weeks; the three hard training weeks are the lowest.">
                {weeks.map((week) => (
                  <div
                    key={week.label}
                    title={`Week of ${week.label}: ${formatHours(week.hours)}${week.hard ? " (hard week)" : ""}`}
                    className="group flex h-full flex-1 items-end px-1"
                  >
                    <div
                      className={`w-full rounded-t-[4px] transition-opacity group-hover:opacity-80 ${week.hard ? "bg-brand" : "bg-muted-foreground/25"}`}
                      style={{ height: `${(week.hours / MAX_HOURS) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between border-t pt-1.5 text-[10px] text-muted-foreground">
                <span>{weeks[0].label}</span>
                <span>{weeks[weeks.length - 1].label}</span>
              </div>
            </div>

            <p className="leading-relaxed text-pretty">
              Your resting heart rate ran 3 bpm higher in the same weeks.
            </p>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">
        An example with demo data. Works with Claude and other MCP clients.
      </figcaption>
    </figure>
  );
}
