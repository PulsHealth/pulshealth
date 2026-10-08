import { notFound } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { recoveryAvailable } from "@/lib/accounts/recovery";
import { viewerMode } from "@/lib/mode";
export const dynamic = "force-dynamic";
export const metadata = { title: "Reset password — PulsHealth" };
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (viewerMode() !== "accounts") notFound();
  const sent = (await searchParams).sent === "1";
  return <AuthCard title="Reset your password" subtitle="Enter the email you use to sign in."
    notice={sent ? "If an active account matches that email, a reset link will arrive shortly. Check your spam folder too." : undefined}>
    {recoveryAvailable() && <form method="post" action="/api/auth/forgot-password">
      <div className="form-field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" maxLength={254} required /></div>
      <button className="btn btn-primary btn-block" type="submit">Send reset link</button>
    </form>}
    <p className="form-hint">If email recovery is unavailable or no link arrives, contact your viewer administrator for a new invite. For PulsHealth-hosted accounts, <a href="https://pulshealth.com/support">contact PulsHealth support</a>.</p>
    <p><a href="/login">Back to sign in</a></p>
  </AuthCard>;
}
