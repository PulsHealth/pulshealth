import { getAllSearchItems } from "@/lib/api";

// Rendered once at build time into out/search-index.json. The search dialog
// fetches it the first time it opens, so the ~190 entries are not inlined
// into every page's HTML.
export const dynamic = "force-static";

export async function GET() {
  return Response.json(await getAllSearchItems());
}
