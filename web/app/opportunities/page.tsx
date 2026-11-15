import { notFound } from "next/navigation";
import { viewerMode } from "@/lib/mode";
import { CollectionInvitation } from "@/components/CollectionRequests";
export const dynamic = "force-dynamic";
export default function OpportunitiesPage(){if(viewerMode()!=="accounts")notFound();return <CollectionInvitation/>;}
