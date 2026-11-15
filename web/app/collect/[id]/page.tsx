import { notFound } from "next/navigation";
import { viewerMode } from "@/lib/mode";
import { UUID } from "@/lib/collections/model";
import { CollectionInvitation } from "@/components/CollectionRequests";
export const dynamic = "force-dynamic";
export default async function InvitationPage({params}:{params:Promise<{id:string}>}){const {id}=await params;if(viewerMode()!=="accounts"||!UUID.test(id))notFound();return <CollectionInvitation id={id}/>;}
