import { PageHeader } from "@/components/PageHeader";
import { MapStyleSettings } from "@/components/MapStyleSettings";
import { SettingsView } from "@/components/SettingsView";
import { getProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings — PulsHealth" };

export default async function SettingsPage() {
  const profile = await getProfile();
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        subtitle="Preferences are saved in this browser."
      />

      <SettingsView profile={profile} />

      <section className="rise" style={{ marginTop: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Map style</div>
        <MapStyleSettings />
      </section>
    </>
  );
}
