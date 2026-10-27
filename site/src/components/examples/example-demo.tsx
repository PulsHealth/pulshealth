"use client";
import { useState } from "react";
import Link from "next/link";
import recorded from "@/lib/example-recorded.json";
import { parseExampleData } from "@/lib/example-data";
import { buildReport, type Report } from "@/lib/example-report";
import { EXAMPLES, type ExampleSlug } from "@/lib/examples";
import { YearReview } from "./year-review";
import { MarathonReview } from "./marathon-review";
import { ArtStudio, RouteAtlas } from "./route-studio";
import styles from "./examples.module.css";
export function ExampleDemo({
  slug,
  compact = false,
}: {
  slug: ExampleSlug;
  compact?: boolean;
}) {
  const [report, setReport] = useState<Report>(recorded as Report),
    [isExample, setIsExample] = useState(true),
    [error, setError] = useState("");
  const content =
    slug === "year-in-review" ? (
      <YearReview report={report} compact={compact} />
    ) : slug === "marathon-training" ? (
      <MarathonReview report={report} compact={compact} />
    ) : slug === "activity-art" ? (
      <ArtStudio report={report} compact={compact} />
    ) : (
      <RouteAtlas report={report} compact={compact} />
    );
  if (compact) return content;
  return (
    <div className={styles.demo}>
      <div className={styles.demoToolbar}>
        <span className={styles.dataBadge}>
          {isExample ? "Example" : "Your file"}
        </span>
        <details className={styles.importDetails}>
          <summary>Use your data</summary>
          <div>
            <label>
              Open showcase JSON
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 10000000)
                      throw new Error("Choose a file smaller than 10 MB.");
                    const data = parseExampleData(await file.text());
                    setReport(buildReport(data));
                    setIsExample(false);
                    setError("");
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Could not open that file.",
                    );
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <p>Your file stays in this browser.</p>
            <a href="https://github.com/PulsHealth/pulshealth/tree/main/examples/showcase">
              File format and adapter
            </a>
          </div>
        </details>
        {!isExample && (
          <button
            onClick={() => {
              setReport(recorded as Report);
              setIsExample(true);
              setError("");
            }}
          >
            Reset example
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {content}
    </div>
  );
}
export function ExampleDetails({ slug }: { slug: ExampleSlug }) {
  const [copied, setCopied] = useState(false);
  const example = EXAMPLES.find((e) => e.slug === slug)!;
  return (
    <div className={styles.methodNotes}>
      <details>
        <summary>Data notes</summary>
        <p>
          {slug === "year-in-review"
            ? "Steps and daily health metrics use the database’s daily summary surfaces. Sleep uses the longest recorded session on each wake-up day. Monthly heart values are means of daily values. Missing observations remain missing; totals describe recorded coverage."
            : slug === "marathon-training"
              ? "Sixteen Monday-starting calendar weeks. The selected race workout is separate from training. Gaps mean no recorded runs, rather than confirmed rest. Distances and durations are watch measurements. This is a retrospective, not a training prescription."
              : "Recorded route shapes with location labels and original coordinates omitted. Collection and orbit modes scale routes independently; orbit also rotates them. Atlas and layers preserve a shared local projection. The example selects a local area and retains its original input sampling. Shapes can still reveal recognizable places."}
        </p>
      </details>
      <details>
        <summary>Make one with AI</summary>
        <p className={styles.prompt}>{example.prompt}</p>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(example.prompt);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy brief"}
        </button>
        <a href="https://github.com/PulsHealth/pulshealth/tree/main/examples/showcase">
          Source and local setup
        </a>
        <Link href="/docs/ai/">Connect your AI</Link>
      </details>
    </div>
  );
}
