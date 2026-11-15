import { NextRequest } from "next/server";
import { manage } from "@/lib/collections/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (r: NextRequest) => manage(r, true);
export const POST = GET;
