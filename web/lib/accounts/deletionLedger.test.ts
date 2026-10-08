import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { writeDeletionLedger } from "./deletionLedger";

const original = process.env.PULS_DELETION_LEDGER_DIR;
let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  if (original === undefined) delete process.env.PULS_DELETION_LEDGER_DIR;
  else process.env.PULS_DELETION_LEDGER_DIR = original;
});

it("writes a durable minimal restore record with private file permissions", async () => {
  directory = await mkdtemp(join(tmpdir(), "puls-ledger-test-"));
  process.env.PULS_DELETION_LEDGER_DIR = directory;
  const id = "10000000-0000-4000-8000-000000000001";
  await writeDeletionLedger(id);
  await writeDeletionLedger(id);
  expect(await readdir(directory)).toEqual([`${id}.json`]);
  const path = join(directory, `${id}.json`);
  const record = JSON.parse(await readFile(path, "utf8"));
  expect(record).toEqual({ version: 1, user_id: id, requested_at: expect.any(String) });
  expect(Number.isNaN(Date.parse(record.requested_at))).toBe(false);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

it("fails closed without the independent ledger volume", async () => {
  delete process.env.PULS_DELETION_LEDGER_DIR;
  await expect(writeDeletionLedger("10000000-0000-4000-8000-000000000001")).rejects.toThrow("must be configured");
});
