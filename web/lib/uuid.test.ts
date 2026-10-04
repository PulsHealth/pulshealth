import { describe, expect, it } from "vitest";

import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts the canonical form in any version and case, as ingest does", () => {
    for (const id of [
      "11111111-1111-4111-8111-111111111111", // v4
      "5ea4d000-0000-4000-8000-000000000001", // the seeded default user
      "0190f5a8-3c4b-7d2e-9f10-123456789abc", // v7
      "00000000-0000-0000-0000-000000000000", // nil
      "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
    ]) {
      expect(isUuid(id), id).toBe(true);
    }
  });

  it("refuses anything a ::uuid cast or ingest would reject", () => {
    for (const value of [
      "",
      "not-a-uuid",
      "11111111-1111-4111-8111-11111111111", // one short
      "11111111-1111-4111-8111-1111111111111", // one long
      "111111111111411181111111111111111111", // no hyphens
      "{11111111-1111-4111-8111-111111111111}",
      " 11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111\n",
      "g1111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111'; DROP TABLE users;--",
      undefined,
      null,
      42,
    ]) {
      expect(isUuid(value), String(value)).toBe(false);
    }
  });
});
