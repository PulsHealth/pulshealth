// Fails the integration run when it is required and has no database, so the
// other *.integration.test.ts suites cannot all skip quietly in CI. Runs with
// them (`npm run test:integration`) and with `npm test`; without the switch,
// it only checks the rule itself.

import { describe, expect, it } from "vitest";

import { integrationDatabases, requireIntegrationDatabases } from "./integrationEnv";

describe("web integration environment", () => {
  it.runIf(integrationDatabases().required)("has both database URLs when the run requires them", () => {
    expect(() => requireIntegrationDatabases()).not.toThrow();
  });

  it("skips locally, fails when required", () => {
    const both = { WEB_APP_DATABASE_URL: "postgres://web", ADMIN_DATABASE_URL: "postgres://admin" };
    expect(integrationDatabases({}).available).toBe(false);
    expect(integrationDatabases({}).required).toBe(false);
    expect(() => requireIntegrationDatabases({})).not.toThrow();
    expect(integrationDatabases(both).available).toBe(true);
    for (const flag of ["PULS_CI_REQUIRE_INTEGRATION", "PULS_WEB_INTEGRATION"]) {
      expect(() => requireIntegrationDatabases({ [flag]: "1" }), flag).toThrow(/missing/);
      expect(() => requireIntegrationDatabases({ [flag]: "1", WEB_APP_DATABASE_URL: "postgres://web" }), flag).toThrow(/missing/);
      expect(requireIntegrationDatabases({ [flag]: "1", ...both }).available, flag).toBe(true);
    }
    expect(integrationDatabases({ PULS_CI_REQUIRE_INTEGRATION: "0" }).required).toBe(false);
  });
});
