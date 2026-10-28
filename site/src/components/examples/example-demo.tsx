"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import recorded from "@/lib/example-recorded.json";
import { parseExampleData } from "@/lib/example-data";
import { buildReport, type Report } from "@/lib/example-report";
import { EXAMPLES, type ExampleSlug } from "@/lib/examples";
import { WorkoutAnalysis } from "./workout-analysis";
import { SensorReview } from "./sensor-review";
import { SleepReview } from "./sleep-review";
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
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [linkStatus, setLinkStatus] = useState("");
  const content =
    slug === "year-in-review" ? (
      <YearReview report={report} compact={compact} />
    ) : slug === "marathon-training" ? (
      <MarathonReview report={report} compact={compact} />
    ) : slug === "activity-art" ? (
      <ArtStudio report={report} compact={compact} />
    ) : slug === "deep-workout-analysis" ? (
      <WorkoutAnalysis report={report} compact={compact} />
    ) : (
      <RouteAtlas report={report} compact={compact} />
    );
  if (slug === "heart-rate-sensors") return <SensorReview compact={compact} />;
  if (slug === "sleep-and-parenthood") return <SleepReview compact={compact} />;
  if (compact) return content;
  return (
    <div className={styles.demo}>
      <div className={styles.demoToolbar}>
        <span className={styles.dataBadge}>
          {isExample ? "Inspiration" : "Your file"}
        </span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `https://pulshealth.com/examples/${slug}/`,
              );
              setLinkStatus("Link copied");
            } catch {
              setLinkStatus("Could not copy link");
            }
          }}
        >
          Copy link
        </button>
        <span role="status" className={styles.micro}>
          {linkStatus}
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
                    setRevision((n) => n + 1);
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
              setRevision((n) => n + 1);
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
      <Fragment key={revision}>{content}</Fragment>
    </div>
  );
}
export function ExampleDetails({ slug }: { slug: ExampleSlug }) {
  const [copied, setCopied] = useState(false);
  const example = EXAMPLES.find((e) => e.slug === slug)!;
  return (
    <div className={styles.methodNotes}>
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
