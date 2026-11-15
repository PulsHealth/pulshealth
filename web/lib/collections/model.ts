import { CATALOG, typeByIdentifier } from "../catalog";

export const COLLECTION_TYPES = CATALOG.filter(t => t.kind === "quantity" || t.kind === "category");
export interface CollectionMetric { type: string; function: string; required: boolean; unit: string | null }
export interface RequestDefinition {
  title: string; organizer: string; kind: "general" | "group" | "study";
  purpose: string; contact: string; consentText: string;
  mode: "once" | "ongoing"; historyDays: number; durationDays: number; retentionDays: number;
  metrics: CollectionMetric[];
}
export interface CollectionRequest extends RequestDefinition { id: string; version: number; status: string; listing: string }
export interface Enrollment {
  id: string; request: CollectionRequest; status: string; metrics: CollectionMetric[];
  start: number; end: number; generation: number; lastReceived: number | null; consentedAt: number;
}
export interface CollectionList { requests: CollectionRequest[]; enrollments: Enrollment[] }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string, max: number, required = true): string {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) throw new Error(`Check ${name}.`);
  return value.trim();
}
function integer(value: unknown, name: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) throw new Error(`Check ${name} (1–${max}).`);
  return value;
}
export function metrics(value: unknown): CollectionMetric[] {
  if (!Array.isArray(value) || !value.length || value.length > 30) throw new Error("Choose 1–30 metrics.");
  const result = value.map(v => {
    const m = object(v), t = typeByIdentifier(String(m.type));
    if (!t || !COLLECTION_TYPES.includes(t)) throw new Error("Unsupported metric.");
    if (m.function !== "raw" && !t.allowedAggregateFunctions.some(f => f === m.function)) throw new Error("Unsupported aggregate.");
    if (typeof m.required !== "boolean") throw new Error("Choose required or optional.");
    return { type: t.identifier, function: String(m.function), required: m.required, unit: m.function === "duration" ? "s" : t.unit };
  });
  if (new Set(result.map(m => `${m.type}:${m.function}`)).size !== result.length) throw new Error("Remove duplicate metrics.");
  return result;
}
export function definition(value: unknown): RequestDefinition {
  const v = object(value);
  if (!["general", "group", "study"].includes(String(v.kind)) || !["once", "ongoing"].includes(String(v.mode))) throw new Error("Choose a request type and collection mode.");
  return {
    title: string(v.title, "title", 120), organizer: string(v.organizer, "organizer", 120),
    kind: v.kind as RequestDefinition["kind"], mode: v.mode as RequestDefinition["mode"],
    purpose: string(v.purpose, "purpose", 2000), contact: string(v.contact, "contact", 254),
    consentText: string(v.consentText, "consent details", 5000),
    historyDays: integer(v.historyDays, "history days", 3650), durationDays: integer(v.durationDays, "duration days", 365),
    retentionDays: integer(v.retentionDays, "retention days", 365), metrics: metrics(v.metrics),
  };
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: unknown): string { if (typeof v !== "string" || !UUID.test(v)) throw new Error("Invalid identifier."); return v; }

/** Allowlist the collection envelope; profile, device, source and arbitrary metadata never enter storage. */
export function batch(value: unknown) {
  const v = object(value);
  const batchID = uuid(v.batchID);
  if (!Array.isArray(v.records) || v.records.length > 5000 || !Array.isArray(v.deletions) || v.deletions.length > 5000) throw new Error("Invalid batch size.");
  const records = v.records.map(input => {
    const r = object(input), t = typeByIdentifier(String(r.type));
    if (!t || !COLLECTION_TYPES.includes(t)) throw new Error("Unsupported record type.");
    if (Object.keys(r).some(k => !["key", "type", "function", "start", "end", "value", "category", "unit"].includes(k))) throw new Error("Unexpected record field.");
    if (r.function !== "raw" && !t.allowedAggregateFunctions.some(f => f === r.function)) throw new Error("Unsupported function.");
    if (![r.start, r.end].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) || Number(r.end) < Number(r.start)) throw new Error("Invalid dates.");
    const unit = r.function === "duration" ? "s" : t.unit;
    if ((r.unit ?? null) !== unit) throw new Error("Non-canonical unit.");
    if (t.kind === "category") {
      if (r.function !== "raw" || !Number.isSafeInteger(r.category) || r.value != null) throw new Error("Invalid category.");
    } else if (r.category != null || !(typeof r.value === "number" && Number.isFinite(r.value) || r.value === null && r.function !== "raw")) throw new Error("Invalid quantity.");
    const key = r.function === "raw" ? uuid(r.key).toLowerCase() : `${t.identifier}:${r.function}:${r.start}`;
    if (r.key !== key) throw new Error("Invalid record key.");
    return { key, type: t.identifier, function: r.function, start: r.start, end: r.end,
      value: r.value ?? null, category: r.category ?? null, unit };
  });
  return { batchID, records, deletions: v.deletions.map(d => uuid(d).toLowerCase()) };
}
