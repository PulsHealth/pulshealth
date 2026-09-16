import { PageHeader } from "@/components/PageHeader";
import { MapStyleSettings } from "@/components/MapStyleSettings";
import { SettingsView } from "@/components/SettingsView";
import { getProfile, getUsers } from "@/lib/queries";
import { viewerUser } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings — PulsHealth" };

export default async function SettingsPage() {
  const userId = await viewerUser();
  const [profile, users] = await Promise.all([getProfile(userId), getUsers()]);
  const user = users.find((u) => u.id === userId) ?? { id: userId, name: null, email: null };
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        subtitle="Preferences are saved in this browser."
      />

      <SettingsView profile={profile} user={user} />

      <section className="rise" style={{ marginTop: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Map style</div>
        <MapStyleSettings />
      </section>
    </>
  );
}
