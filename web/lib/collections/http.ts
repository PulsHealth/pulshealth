import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { accountsOnly, requestSession, refuseDemo } from "../accounts/http";
import { findSession, newToken, tokenHash } from "../accounts/session";
import { readBodyCapped } from "../oauth/http";
import { query } from "../db";
import { batch, definition, metrics, object, uuid } from "./model";

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
const bearer = (r: NextRequest) => /^Bearer ([A-Za-z0-9_-]{43})$/.exec(r.headers.get("authorization") ?? "")?.[1];
async function body(r: NextRequest, limit: number) {
  const raw = await readBodyCapped(r, limit);
  if (raw === null) throw new Error("Request too large.");
  return object(JSON.parse(raw));
}
export async function manage(request: NextRequest, native: boolean) {
  const unavailable = accountsOnly(); if (unavailable) return unavailable;
  const session = native ? await findSession(bearer(request)) : await requestSession(request);
  if (session?.demo && !native) return refuseDemo(session)!;
  if (!session || session.demo) return json({ error: "Sign in to a personal account." }, 401);
  try {
    const input = request.method === "GET" ? { action: "list" } : await body(request, 48_000);
    const action = String(input.action);
    const data: Record<string, unknown> = {};
    let token: string | undefined, invite: string | undefined;
    if (!["list", "create", "review-list", "join", "pause", "resume", "stop", "finish", "credential", "close", "invite", "participants", "export", "review"].includes(action)) throw new Error("Unknown action.");
    if (!["list", "create", "review-list"].includes(action)) data.id = uuid(input.id);
    if (action === "create" || action === "invite") {
      invite = newToken(); data.inviteHash = tokenHash(invite)!.toString("hex");
    }
    if (action === "create") { data.definition = definition(input.definition); data.listed = input.listed === true; }
    if (["join", "resume", "credential"].includes(action)) { token = newToken(); data.tokenHash = tokenHash(token)!.toString("hex"); }
    if (action === "join") {
      if (input.accepted !== true || input.version !== 1) throw new Error("Review and accept this request.");
      data.accepted = true; data.version = 1; data.metrics = metrics(input.metrics);
      data.inviteHash = tokenHash(typeof input.invite === "string" ? input.invite : null)?.toString("hex") ?? "";
    }
    if (action === "export") {
      if (input.after !== undefined && (!Number.isSafeInteger(input.after) || Number(input.after) < 0)) throw new Error("Invalid export cursor.");
      data.after = input.after ?? 0;
    }
    if (action === "review") {
      if (!["approved", "declined"].includes(String(input.decision))) throw new Error("Invalid decision.");
      data.decision = input.decision;
    }
    const rows = await query<{ result: unknown }>("SELECT collections.command($1,$2,$3::jsonb) AS result", [action, session.id, JSON.stringify(data)]);
    return json({ result: rows[0].result, ...(token ? { token } : {}), ...(invite ? { invite } : {}) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "You no longer have access to this request." }, 403);
    if (code === "P0002") return json({ error: "Request not found." }, 404);
    if (code === "23505") return json({ error: "You have already joined this request. Open it in Sharing." }, 409);
    if (code) return json({ error: code === "22023" ? "This action is outside the request’s approved scope or current state." : "Unable to save this change." }, code === "22023" ? 400 : 500);
    return json({ error: error instanceof Error ? error.message : "Invalid request." }, 400);
  }
}
export async function discover(request: NextRequest) {
  const unavailable = accountsOnly(); if (unavailable) return unavailable;
  try {
    const id = request.nextUrl.searchParams.get("id");
    const rows = await query<{ result: unknown }>("SELECT collections.discover($1,$2) AS result", [id ? uuid(id) : null, tokenHash(request.headers.get("x-collection-invite"))]);
    return json({ result: rows[0].result });
  } catch { return json({ error: "Unable to load requests." }, 400); }
}
export async function upload(request: NextRequest) {
  const unavailable = accountsOnly(); if (unavailable) return unavailable;
  const hash = tokenHash(bearer(request));
  if (!hash) return json({ error: "Sharing credential required." }, 401);
  try {
    const raw = await readBodyCapped(request, 4_000_000);
    if (raw === null) return json({ error: "Batch too large." }, 413);
    const b = batch(JSON.parse(raw));
    // The digest is over the actual submitted UTF-8 bytes, not a reserialized object.
    const digest = createHash("sha256").update(raw).digest("hex");
    const rows = await query<{ result: unknown }>("SELECT collections.upload($1,$2,$3,$4::jsonb,$5::jsonb) AS result", [hash, b.batchID, digest, JSON.stringify(b.records), JSON.stringify(b.deletions)]);
    return json(rows[0].result);
  } catch (error) {
    const code = (error as { code?: string }).code;
    return json({ error: code === "42501" ? "Sharing is no longer active." : "Batch rejected; no data was acknowledged." }, code === "42501" ? 403 : code && code !== "22023" ? 500 : 400);
  }
}
