import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/lib/viewer";
import { viewerMode } from "@/lib/mode";
import { CollectionRequests } from "@/components/CollectionRequests";
export const dynamic = "force-dynamic";
export default async function RequestsPage() {
  if (viewerMode() !== "accounts") notFound();
  const session = await currentSession();
  if (!session) redirect("/login?next=%2Frequests");
  if (session.demo) notFound();
  return <CollectionRequests admin={session.isAdmin}/>;
}
