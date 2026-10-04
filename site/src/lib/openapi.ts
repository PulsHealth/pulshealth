/**
 * Read the product API's OpenAPI document (`server/api/openapi.json`, the file
 * the Go service embeds and serves at `/openapi.json`) into what the API
 * reference page renders: operations grouped by tag, parameters with their
 * `$ref`s resolved, response fields flattened into rows, and an example body
 * synthesised from the schema.
 *
 * Only the subset of OpenAPI 3.1 the document uses is understood: local
 * `$ref`s, `allOf`, `type` arrays for nullability, `prefixItems` tuples and
 * `additionalProperties` maps. Anything else renders as its bare type.
 */

import { readRepoFile } from "@/lib/markdown";

/* eslint-disable @typescript-eslint/no-explicit-any -- the document is untyped JSON */
type Json = any;

export interface ApiParameter {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  type: string;
  /** Default, bounds and allowed values, already formatted for display. */
  constraints: string[];
  example?: string | number;
}

export interface ApiField {
  /** Dotted path from the response root, `[]` marking an array level. */
  path: string;
  depth: number;
  type: string;
  description?: string;
}

export interface ApiResponse {
  status: string;
  description: string;
  /** Media types the response can carry. */
  contentTypes: string[];
  /** JSON responses only: flattened fields and an example body. */
  fields?: ApiField[];
  example?: string;
  headers: Array<{ name: string; description?: string }>;
}

export interface ApiOperation {
  id: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  tag: string;
  authenticated: boolean;
  parameters: ApiParameter[];
  responses: ApiResponse[];
  curl: string;
}

export interface ApiTag {
  name: string;
  description?: string;
  /** Anchor id of the tag's section. */
  id: string;
  operations: ApiOperation[];
}

export interface ApiDocument {
  title: string;
  version: string;
  summary?: string;
  tags: ApiTag[];
  /** How many operations the document describes. */
  operationCount: number;
}

/** The example base URL the reference's curl lines use. */
export const EXAMPLE_BASE_URL = "http://127.0.0.1:8081";

const MAX_FIELD_DEPTH = 5;

export function tagAnchor(name: string): string {
  return `tag-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function resolve(doc: Json, node: Json): Json {
  let current = node;
  const seen = new Set<string>();
  while (current && typeof current === "object" && typeof current.$ref === "string") {
    const ref: string = current.$ref;
    if (seen.has(ref) || !ref.startsWith("#/")) break;
    seen.add(ref);
    current = ref
      .slice(2)
      .split("/")
      .reduce((value: Json, key: string) => (value == null ? value : value[key]), doc);
  }
  return current;
}

/** allOf members merged into one object schema; everything else unchanged. */
function flatten(doc: Json, schema: Json): Json {
  const resolved = resolve(doc, schema);
  if (!resolved || !Array.isArray(resolved.allOf)) return resolved;
  const merged: Json = { type: "object", properties: {}, description: resolved.description };
  for (const part of resolved.allOf) {
    const member = flatten(doc, part);
    Object.assign(merged.properties, member?.properties ?? {});
    merged.description ??= member?.description;
  }
  return merged;
}

function refName(schema: Json): string | undefined {
  return typeof schema?.$ref === "string" ? schema.$ref.split("/").pop() : undefined;
}

/** "string (uuid)", "integer | null", "array of LatestMetric", "map of object". */
export function typeLabel(doc: Json, schema: Json): string {
  const name = refName(schema);
  const s = flatten(doc, schema);
  if (!s) return "any";
  const types: string[] = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const nullable = types.includes("null");
  const base = types.filter((t) => t !== "null")[0] ?? (s.properties ? "object" : "any");
  let label: string;
  if (base === "array") {
    if (Array.isArray(s.prefixItems)) {
      label = `[${s.prefixItems.map((item: Json) => typeLabel(doc, item)).join(", ")}]`;
    } else {
      label = `array of ${typeLabel(doc, s.items)}`;
    }
  } else if (base === "object" && s.additionalProperties && typeof s.additionalProperties === "object" && !s.properties) {
    label = `map of ${typeLabel(doc, s.additionalProperties)}`;
  } else if (name && base === "object") {
    label = name;
  } else {
    label = s.format ? `${base} (${s.format})` : base;
  }
  return nullable ? `${label} | null` : label;
}

function constraintsOf(schema: Json): string[] {
  const out: string[] = [];
  if (!schema) return out;
  if (Array.isArray(schema.enum)) out.push(`One of: ${schema.enum.map((v: unknown) => `\`${v}\``).join(", ")}`);
  if (schema.default !== undefined) out.push(`Default: \`${schema.default}\``);
  if (schema.maximum !== undefined && schema.maximum < 1e12) out.push(`Maximum: \`${schema.maximum}\``);
  return out;
}

function fieldRows(doc: Json, schema: Json, prefix: string, depth: number, seen: Set<Json>): ApiField[] {
  const s = flatten(doc, schema);
  if (!s || depth > MAX_FIELD_DEPTH || seen.has(s)) return [];
  const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes("array") && s.items && !s.prefixItems) {
    return fieldRows(doc, s.items, `${prefix}[]`, depth, seen);
  }
  if (!s.properties) return [];
  const next = new Set(seen).add(s);
  const rows: ApiField[] = [];
  for (const [name, property] of Object.entries<Json>(s.properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const resolved = flatten(doc, property);
    rows.push({
      path,
      depth,
      type: typeLabel(doc, property),
      description: resolved?.description ?? property?.description,
    });
    rows.push(...fieldRows(doc, property, path, depth + 1, next));
  }
  return rows;
}

const EXAMPLE_UUID = "5ea4d000-0000-4000-8000-000000000001";
const EXAMPLE_MS = 1767225600000;

/** A plausible value for a schema: its own example, else one by type and name. */
export function exampleFor(doc: Json, schema: Json, name = "", depth = 0, seen = new Set<Json>()): unknown {
  const s = flatten(doc, schema);
  if (!s || depth > 8 || seen.has(s)) return null;
  if (Array.isArray(s.examples) && s.examples.length > 0) return s.examples[0];
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum)) return s.enum[0];
  const types: string[] = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const base = types.filter((t) => t !== "null")[0] ?? (s.properties ? "object" : undefined);
  const next = new Set(seen).add(s);
  switch (base) {
    case "object": {
      if (s.properties) {
        return Object.fromEntries(
          Object.entries<Json>(s.properties).map(([key, value]) => [key, exampleFor(doc, value, key, depth + 1, next)]),
        );
      }
      if (s.additionalProperties && typeof s.additionalProperties === "object") {
        return { HKQuantityTypeIdentifierHeartRate: exampleFor(doc, s.additionalProperties, "", depth + 1, next) };
      }
      return {};
    }
    case "array":
      if (Array.isArray(s.prefixItems)) return [EXAMPLE_MS, 142];
      return [exampleFor(doc, s.items, name, depth + 1, next)];
    case "string":
      if (s.format === "uuid") return EXAMPLE_UUID;
      if (s.format === "date") return "2026-01-01";
      if (/identifier|type$/i.test(name)) return "HKQuantityTypeIdentifierStepCount";
      if (/unit/i.test(name)) return "count";
      return "string";
    case "integer":
      if (s.format === "int64" && /start|end|time|sync|latest|earliest|created|generated|birth|^t$/i.test(name)) {
        return /end|latest/i.test(name) ? EXAMPLE_MS + 3_600_000 : EXAMPLE_MS;
      }
      return 0;
    case "number":
      return 0;
    case "boolean":
      return true;
    default:
      return null;
  }
}

function parameterOf(doc: Json, raw: Json): ApiParameter {
  const p = resolve(doc, raw);
  const example = p.example ?? p.schema?.examples?.[0];
  return {
    name: p.name,
    in: p.in,
    required: Boolean(p.required),
    description: p.description,
    type: typeLabel(doc, p.schema),
    constraints: constraintsOf(p.schema),
    example,
  };
}

/** A copy-pasteable curl line with every required parameter filled in. */
function curlFor(path: string, authenticated: boolean, parameters: ApiParameter[]): string {
  let url = path;
  const query: string[] = [];
  for (const p of parameters) {
    if (p.in === "path") url = url.replace(`{${p.name}}`, EXAMPLE_UUID);
    else if (p.in === "query" && p.required) {
      let value = p.example;
      if (value === undefined) {
        if (p.name === "types" || p.name === "type") value = "HKQuantityTypeIdentifierStepCount";
        else if (p.constraints[0]?.startsWith("One of:")) value = p.constraints[0].match(/`([^`]+)`/)?.[1];
        else value = "...";
      }
      query.push(`${p.name}=${value}`);
    }
  }
  const target = `${EXAMPLE_BASE_URL}${url}${query.length ? `?${query.join("&")}` : ""}`;
  return authenticated
    ? `curl -H "Authorization: Bearer $PULS_API_TOKEN" \\\n  "${target}"`
    : `curl "${target}"`;
}

function responseOf(doc: Json, status: string, raw: Json): ApiResponse {
  const r = resolve(doc, raw);
  const content: Json = r.content ?? {};
  const json = content["application/json"];
  const response: ApiResponse = {
    status,
    description: r.description ?? "",
    contentTypes: Object.keys(content),
    headers: Object.entries<Json>(r.headers ?? {}).map(([name, header]) => ({ name, description: header?.description })),
  };
  if (json?.schema && status.startsWith("2")) {
    response.fields = fieldRows(doc, json.schema, "", 0, new Set());
    response.example = JSON.stringify(exampleFor(doc, json.schema), null, 2);
  }
  return response;
}

export function loadApiDocument(repoPath: string): { doc: ApiDocument; raw: Json } | null {
  const text = readRepoFile(repoPath);
  if (!text) return null;
  const raw: Json = JSON.parse(text);
  const globalSecurity = Array.isArray(raw.security) && raw.security.length > 0;

  const tagOrder: Array<{ name: string; description?: string }> = raw.tags ?? [];
  const byTag = new Map<string, ApiOperation[]>(tagOrder.map((t) => [t.name, []]));
  let count = 0;
  for (const [path, item] of Object.entries<Json>(raw.paths ?? {})) {
    for (const [method, op] of Object.entries<Json>(item)) {
      const parameters = (op.parameters ?? []).map((p: Json) => parameterOf(raw, p));
      const authenticated = op.security ? op.security.length > 0 : globalSecurity;
      const tag = op.tags?.[0] ?? "Other";
      const operation: ApiOperation = {
        id: op.operationId ?? `${method}-${path}`,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? path,
        description: op.description,
        tag,
        authenticated,
        parameters,
        responses: Object.entries<Json>(op.responses ?? {}).map(([status, r]) => responseOf(raw, status, r)),
        curl: curlFor(path, authenticated, parameters),
      };
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(operation);
      count++;
    }
  }
  const descriptions = new Map(tagOrder.map((t) => [t.name, t.description]));
  return {
    raw,
    doc: {
      title: raw.info?.title ?? "API",
      version: raw.info?.version ?? "",
      summary: raw.info?.summary,
      operationCount: count,
      tags: [...byTag.entries()]
        .filter(([, operations]) => operations.length > 0)
        .map(([name, operations]) => ({ name, description: descriptions.get(name), id: tagAnchor(name), operations })),
    },
  };
}
