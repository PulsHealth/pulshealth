import { notFound } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { errorMessage, param } from "@/lib/accounts/messages";
import { PASSWORD_MIN_LENGTH } from "@/lib/accounts/password";
import { usablePasswordReset } from "@/lib/accounts/recovery";
import { viewerMode } from "@/lib/mode";
export const dynamic = "force-dynamic";
export const metadata = { title: "Choose password — PulsHealth", referrer: "no-referrer" as const };
export default async function ResetPasswordPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (viewerMode() !== "accounts") notFound();
  const { token } = await params;
  let usable: boolean;
  try { usable = await usablePasswordReset(token); }
  catch { return <AuthCard title="Recovery unavailable" error={errorMessage("unavailable")} />; }
  if (!usable) return <AuthCard title="This link has expired" subtitle="Reset links work once and expire after 30 minutes."><a href="/forgot-password">Request another link</a></AuthCard>;
  return <AuthCard title="Choose a new password" subtitle="This signs out every browser and disconnects AI assistants. Existing assistant access expires within 30 minutes."
    error={errorMessage(param((await searchParams).error), { invalid: "This reset link has expired or was already used." })}>
    <form method="post" action="/api/auth/reset-password">
      <input type="hidden" name="token" value={token} />
      <div className="form-field"><label htmlFor="password">New password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={256} required /></div>
      <div className="form-field"><label htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></div>
      <button className="btn btn-primary btn-block" type="submit">Reset password</button>
    </form>
  </AuthCard>;
}
