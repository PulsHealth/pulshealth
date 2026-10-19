import { describe, expect, it } from "vitest";
import { verifierFor } from "./verify";

describe("Apple trust roots and verifier", () => {
  it("loads public certificates and rejects an unsigned notification in each environment", async () => {
    for (const sandbox of [false, true]) {
      const verifier = verifierFor(sandbox);
      expect(verifierFor(sandbox)).toBe(verifier);
      await expect(verifier.verifyAndDecodeNotification("eyJhbGciOiJub25lIn0.eyJub3RpZmljYXRpb25UeXBlIjoiVEVTVCJ9.")).rejects.toThrow();
    }
  });
});
