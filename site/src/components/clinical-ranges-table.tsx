import { Ruler } from "lucide-react";

import { cn } from "@/lib/utils";

interface ClinicalRange {
  population: string;
  notes?: string;
  [key: string]: string | undefined;
}

interface ClinicalRangesTableProps {
  ranges: ClinicalRange[];
}

/** Columns whose value is the healthy range, shown in green. */
const HEALTHY = new Set(["normal", "average"]);

function label(key: string) {
  return key.replace(/_/g, " ");
}

function Value({ name, value }: { name: string; value?: string }) {
  if (!value) return <span className="text-muted-foreground/40">–</span>;
  if (!HEALTHY.has(name)) return <>{value}</>;
  return (
    <span className="inline-block rounded-md border border-green-200 bg-green-50 px-1.5 py-0.5 font-medium text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
      {value}
    </span>
  );
}

/**
 * Ranges by population. Values are often whole sentences, so the cells wrap
 * rather than push columns off the edge, and on phones each population is a
 * card of label and value pairs instead of a table.
 */
export function ClinicalRangesTable({ ranges }: ClinicalRangesTableProps) {
  if (!ranges || ranges.length === 0) return null;

  // Every column any range has, apart from population and notes.
  const dataKeys = Array.from(new Set(ranges.flatMap((r) => Object.keys(r)))).filter(
    (key) => key !== "population" && key !== "notes" && ranges.some((r) => r[key]),
  );

  if (dataKeys.length === 0) return null;

  return (
    <section>
      <h2 className="mb-4 flex items-center text-2xl font-semibold">
        <Ruler className="mr-2 h-5 w-5 text-brand" />
        Clinical Ranges
      </h2>

      {/* Phones: one card per population. */}
      <ul className="space-y-3 md:hidden">
        {ranges.map((range, i) => (
          <li key={i} className="rounded-xl border bg-card p-4 text-sm">
            <p className="mb-3 font-medium">{range.population}</p>
            <dl className="space-y-2">
              {dataKeys
                .filter((key) => range[key])
                .map((key) => (
                  <div key={key} className="grid grid-cols-[6rem_1fr] gap-3">
                    <dt className="capitalize text-muted-foreground">{label(key)}</dt>
                    <dd className="min-w-0 break-words">
                      <Value name={key} value={range[key]} />
                    </dd>
                  </div>
                ))}
            </dl>
            {range.notes && <p className="mt-3 text-xs text-muted-foreground">{range.notes}</p>}
          </li>
        ))}
      </ul>

      {/* Wider screens: a table whose cells wrap. */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th scope="col" className="w-[28%] px-4 py-3 font-semibold">Population</th>
              {dataKeys.map((key) => (
                <th key={key} scope="col" className="px-4 py-3 font-semibold capitalize">
                  {label(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranges.map((range, i) => (
              <tr key={i} className={cn("align-top", i < ranges.length - 1 && "border-b")}>
                <th scope="row" className="px-4 py-3 text-left font-medium">
                  {range.population}
                  {range.notes && <p className="mt-1 text-xs font-normal text-muted-foreground">{range.notes}</p>}
                </th>
                {dataKeys.map((key) => (
                  <td key={key} className="min-w-[8rem] px-4 py-3">
                    <Value name={key} value={range[key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
