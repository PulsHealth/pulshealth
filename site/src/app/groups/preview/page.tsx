import type { Metadata } from "next";
import { GroupPreviewExperience } from "@/components/groups/group-preview";

export const metadata: Metadata = {
  title: "Groups preview | PulsHealth",
  description: "Try a concept for joining a study, gym or program and choosing what you share.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/groups/preview/" },
};

export default function GroupsPreviewPage() {
  return <GroupPreviewExperience />;
}
