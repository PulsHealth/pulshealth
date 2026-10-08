// This volume must be independent of database snapshots. Fsync before the
// deletion transaction commits so restoring an older snapshot cannot silently
// restore an account whose owner subsequently requested erasure.
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isUuid } from "../uuid";

export async function writeDeletionLedger(userId: string): Promise<void> {
  if (!isUuid(userId)) throw new Error("Invalid deletion user");
  const directory = process.env.PULS_DELETION_LEDGER_DIR;
  if (!directory) throw new Error("PULS_DELETION_LEDGER_DIR must be configured for account deletion");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const normalized = userId.toLowerCase();
  const target = join(directory, `${normalized}.json`);
  const temporary = join(directory, `.${normalized}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ version: 1, user_id: normalized, requested_at: new Date().toISOString() }) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    const parent = await open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
