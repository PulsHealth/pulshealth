"use client";

import { useState } from "react";
import type { ExampleRecord } from "@/lib/public-demo-types";
import styles from "./record-example.module.css";

function exampleTime(timestamp: number, origin: number): string {
  const day = Math.floor(timestamp / 86400000) - Math.floor(origin / 86400000) + 1;
  return `Day ${day} · ${new Date(timestamp).toISOString().slice(11, 23)}`;
}

export function RecordExample({ records, categories }: {
  records: ExampleRecord[];
  categories: { value: number; name: string; description?: string }[];
}) {
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState("");
  const record = records[selected];
  const json = JSON.stringify(record, null, 2);
  const origin = Math.min(...records.map(r => r.start));
  const category = categories.find(c => c.value === record.category);
  const metadataCount = Object.keys(record.metadata ?? {}).length;
  async function copy(all: boolean) {
    try { await navigator.clipboard.writeText(all ? JSON.stringify(records, null, 2) : json); setStatus(all ? `Copied ${records.length} example records` : "Copied record"); }
    catch { setStatus("Copy unavailable. You can select and copy the JSON below."); }
  }
  function select(index: number) {
    setSelected(index); setStatus("");
    if (matchMedia("(max-width: 800px)").matches) document.getElementById("example-inspector")?.scrollIntoView({ behavior: "instant", block: "start" });
  }
  return (
    <>
      <div className={styles.toolbar}>
        <button type="button" onClick={() => copy(true)}>Copy all records as JSON</button>
      </div>
      <div className={styles.grid}>
        <section className={styles.list} aria-label="Example records">
          <div className={styles.listHeader}><span>Sample interval</span><span>{record.kind === "quantity" ? `Value · ${record.unit}` : "Category code"}</span></div>
          {records.map((r, index) => (
            <button key={r.uuid} type="button" aria-pressed={index === selected} className={styles.row} onClick={() => select(index)}>
              <span><span>{exampleTime(r.start, origin)}</span><small>{r.sourceName ?? "Source not included"}</small></span>
              <span className={styles.value}>{r.value ?? r.category}<small>{r.kind === "category" ? categories.find(c => c.value === r.category)?.name : ""}</small></span>
            </button>
          ))}
        </section>
        <section className={styles.inspector} id="example-inspector" aria-label="Selected example record">
          <div className={styles.inspectorHeader}><h2>Record {selected + 1}</h2><button type="button" onClick={() => copy(false)}>Copy JSON</button></div>
          <dl className={styles.facts}>
            <div><dt>Start → end</dt><dd>{exampleTime(record.start, origin)}<br />{exampleTime(record.end, origin)}</dd></div>
            <div><dt>Duration</dt><dd>{record.end === record.start ? "Point in time" : `${new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format((record.end - record.start) / 1000)} seconds`}</dd></div>
            <div><dt>Source / device</dt><dd>{record.sourceName ?? "Not included"} / {record.device ?? "Not included"}</dd></div>
            <div><dt>Metadata</dt><dd>{record.metadata ? `${metadataCount} ${metadataCount === 1 ? "field" : "fields"}, shown below` : "Not included on this sample"}</dd></div>
          </dl>
          {category?.description && <p className={styles.categoryNote}>{category.description}</p>}
          <p className={styles.status} role="status" aria-live="polite">{status}</p>
          <pre className={styles.json} aria-label="Full example record JSON"><code>{json}</code></pre>
        </section>
      </div>
    </>
  );
}
