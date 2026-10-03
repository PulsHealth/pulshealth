// The databases the *.integration.test.ts suites run against, and whether a
// missing one is a failure or a skip. Test-only.
//
// Locally the suites skip without both URLs, so `npm test` never needs a
// database. In CI they must not: PULS_CI_REQUIRE_INTEGRATION=1 (the
// repository-wide switch) or PULS_WEB_INTEGRATION=1 (this job's own) turns a
// missing URL into a failure — environment.integration.test.ts fails the run,
// and requireIntegrationDatabases() throws at a suite's top level.

export interface IntegrationDatabases {
  /** The viewer's accounts-mode role, web_app. */
  webUrl: string | undefined;
  /** A superuser, for fixtures and the steps the roles may not perform. */
  adminUrl: string | undefined;
  /** Both are set: the suites run. */
  available: boolean;
  /** A missing one must fail the run instead of skipping it. */
  required: boolean;
}

export function integrationDatabases(env: Record<string, string | undefined> = process.env): IntegrationDatabases {
  const webUrl = env.WEB_APP_DATABASE_URL || undefined;
  const adminUrl = env.ADMIN_DATABASE_URL || undefined;
  return {
    webUrl,
    adminUrl,
    available: Boolean(webUrl && adminUrl),
    required: env.PULS_CI_REQUIRE_INTEGRATION === "1" || env.PULS_WEB_INTEGRATION === "1",
  };
}

/** The URLs, throwing when they are required and missing. */
export function requireIntegrationDatabases(env: Record<string, string | undefined> = process.env): IntegrationDatabases {
  const dbs = integrationDatabases(env);
  if (dbs.required && !dbs.available) {
    throw new Error(
      "web integration tests are required (PULS_CI_REQUIRE_INTEGRATION or PULS_WEB_INTEGRATION) " +
        "but WEB_APP_DATABASE_URL or ADMIN_DATABASE_URL is missing",
    );
  }
  return dbs;
}
