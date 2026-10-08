import { longStatement, query, transaction } from "../db";
import { newToken, tokenHash } from "./session";
import { writeDeletionLedger } from "./deletionLedger";
import { PURGE_MINUTES } from "./signups";

/** A receipt is a random capability, never an email or account identifier. */
export async function requestDeletion(session: Buffer): Promise<{ userId: string; receipt: string }> {
  const receipt = newToken();
  const userId = await transaction(async (q) => {
    const [row] = await q<{ user_id: string }>(
      "SELECT auth.request_account_deletion($1, $2)::text AS user_id", [session, tokenHash(receipt)],
    );
    // The function checks protected-account eligibility before any file is
    // written. A disk failure aborts revocation/queue insertion as well.
    await writeDeletionLedger(row.user_id);
    return row.user_id;
  });
  return { userId, receipt };
}

export async function completeDeletion(userId: string): Promise<void> {
  await longStatement("SELECT auth.complete_account_deletion($1::uuid)", [userId], PURGE_MINUTES);
}

export async function deletionStatus(receipt: string): Promise<"pending" | "completed" | null> {
  const hash = tokenHash(receipt);
  if (!hash) return null;
  const [row] = await query<{ completed: boolean }>("SELECT completed FROM auth.deletion_status($1)", [hash]);
  return row ? (row.completed ? "completed" : "pending") : null;
}
