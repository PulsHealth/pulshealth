import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { deletionStatus } from "@/lib/accounts/deletion";
import { viewerMode } from "@/lib/mode";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account deletion — PulsHealth", robots: { index: false, follow: false } };

export default async function DeletionPage({ params }: { params: Promise<{ token: string }> }) {
  if (viewerMode() !== "accounts") notFound();
  const { token } = await params;
  const status = await deletionStatus(token);
  if (!status) notFound();
  return <AuthCard title={status === "completed" ? "Account deleted" : "Deleting your account"} subtitle={
    status === "completed"
      ? "Your account and health records have been removed from the live database."
      : "Your account is disabled and your iPhones are disconnected. Removal of your account and records is queued and will retry automatically."
  }>
    <p style={{ fontSize: 14, lineHeight: 1.6 }}>
      {status === "pending"
        ? "Deletion normally finishes immediately. If the database is busy or unavailable, keep this private link and refresh it to check completion. You do not need to sign in or send another request."
        : "This private confirmation link remains available for 30 days. Minimal deletion records are kept to prevent an older backup from restoring your deleted account."}
    </p>
    <p style={{ fontSize: 14, lineHeight: 1.6 }}>
      Older backups expire under the server’s backup policy. <a href="https://pulshealth.com/privacy">Read the privacy policy</a> for retention details.
    </p>
    {status === "pending" && <a className="btn btn-primary btn-block" href={`/deletion/${token}`}>Check deletion status</a>}
  </AuthCard>;
}
