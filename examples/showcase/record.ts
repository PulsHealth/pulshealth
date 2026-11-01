/** Input records stay private; this emits display summaries and normalized paths. */
import { readFileSync, writeFileSync } from "node:fs";
import { parseExampleData } from "../../site/src/lib/example-data";
import { buildReport } from "../../site/src/lib/example-report";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Usage: bun examples/showcase/record.ts <private-showcase.json> <new-display.json>",
  );
const data = parseExampleData(readFileSync(input, "utf8"));
if (!data.raceId || !data.timeZone)
  throw new Error(
    "Recorded display data requires raceId and timeZone provenance.",
  );
const report = buildReport(data, true);
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(
  `Prepared ${report.totals.workouts} annual workouts, ${report.runs.length} training runs and ${report.routes.length} local route shapes.`,
);
