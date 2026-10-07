import { describe, expect, it } from "vitest";

import { verifyPassword } from "./accounts/password";
import { DEFAULT_DEMO_EMAIL, demoProblem, normalizeEmail, parseArgs, unusableHash } from "../scripts/demo.mjs";

const USER = "0d3a0000-0000-4000-8000-0000000000ab";

describe("scripts/demo.mjs", () => {
  it("parses a demo user, with an address nothing can mail by default", () => {
    expect(DEFAULT_DEMO_EMAIL).toMatch(/\.invalid$/);
    expect(parseArgs(["--user", USER.toUpperCase()], {})).toEqual({ options: { user: USER, email: "demo@demo.invalid" } });
    expect(parseArgs(["--user", USER, "--email", " Sample@Demo.Invalid "], {}).options?.email).toBe("sample@demo.invalid");
    expect(normalizeEmail("a b@c")).toBeNull();
  });

  it("refuses what is not a demo user", () => {
    expect(parseArgs([], {}).error).toMatch(/--user/);
    expect(parseArgs(["--user", "nope"], {}).error).toMatch(/--user/);
    expect(parseArgs(["--user", USER, "--email", "not-an-email"], {}).error).toMatch(/--email/);
    expect(parseArgs(["--user"], {}).error).toMatch(/needs a value/);
    expect(parseArgs(["--bogus"], {}).error).toMatch(/unknown/);
    // Never the household's own user: anyone can open the demo.
    expect(parseArgs(["--user", "5ea4d000-0000-4000-8000-000000000001"], {}).error).toMatch(/household/);
    expect(parseArgs(["--user", USER], { PULS_USER_ID: USER.toUpperCase() }).error).toMatch(/household/);
  });

  it("stores a hash in the viewer's format that no password matches", async () => {
    const hash = await unusableHash();
    expect(hash).toMatch(/^scrypt\$65536\$8\$2\$[A-Za-z0-9_-]{43}\$[A-Za-z0-9_-]{43}$/);
    expect(await unusableHash()).not.toBe(hash);
    for (const guess of ["", "demo", "password", "demo@demo.invalid"]) expect(await verifyPassword(guess, hash)).toBe(false);
  });

  it("accepts an existing account only when the viewer would", () => {
    const fit = { disabled: false, has_password: true, is_admin: false, self_service: false };
    expect(demoProblem(fit)).toBeNull();
    expect(demoProblem({ ...fit, disabled: true })).toMatch(/disabled/);
    expect(demoProblem({ ...fit, has_password: false })).toMatch(/password/);
    expect(demoProblem({ ...fit, is_admin: true })).toMatch(/administrator/);
    expect(demoProblem({ ...fit, self_service: true })).toMatch(/sign-up/);
  });
});
