import { describe, expect, it } from "vitest";

import { authorize, basicAuthPassword, constantTimeEquals, isPublicPath } from "./auth";

const basic = (user: string, password: string) =>
  "Basic " + Buffer.from(`${user}:${password}`, "utf8").toString("base64");

describe("viewer authentication", () => {
  it("is open when no password is configured", async () => {
    for (const password of [undefined, null, ""]) {
      expect(await authorize({ pathname: "/", authorization: null, password })).toBe("open");
      expect(
        await authorize({ pathname: "/workouts", authorization: basic("x", "anything"), password }),
      ).toBe("open");
    }
  });

  it("allows the correct password", async () => {
    expect(
      await authorize({ pathname: "/", authorization: basic("puls", "s3cret"), password: "s3cret" }),
    ).toBe("allow");
  });

  it("accepts any username — the password is the credential", async () => {
    for (const user of ["", "puls", "admin", "someone else"]) {
      expect(
        await authorize({ pathname: "/", authorization: basic(user, "s3cret"), password: "s3cret" }),
      ).toBe("allow");
    }
  });

  it("challenges when credentials are missing, wrong, or malformed", async () => {
    const cases: (string | null | undefined)[] = [
      null,
      undefined,
      "",
      "Bearer s3cret",
      "Basic",
      "Basic ",
      "Basic !!!not-base64!!!",
      Buffer.from("puls:s3cret").toString("base64"), // no scheme
      "Basic " + Buffer.from("no-colon-here").toString("base64"),
      basic("puls", "wrong"),
      basic("puls", "s3cre"), // prefix of the real password
      basic("puls", "s3crett"),
      basic("puls", "S3CRET"),
    ];
    for (const authorization of cases) {
      expect(
        await authorize({ pathname: "/", authorization, password: "s3cret" }),
        `authorization: ${String(authorization)}`,
      ).toBe("challenge");
    }
  });

  it("leaves /api/healthz open so container health checks keep working", async () => {
    expect(
      await authorize({ pathname: "/api/healthz", authorization: null, password: "s3cret" }),
    ).toBe("open");
    expect(isPublicPath("/api/healthz")).toBe(true);
  });

  it("exempts only that exact path", async () => {
    for (const pathname of ["/api/healthz/", "/api/healthzz", "/api", "/api/other", "/healthz"]) {
      expect(isPublicPath(pathname), pathname).toBe(false);
      expect(await authorize({ pathname, authorization: null, password: "s3cret" })).toBe(
        "challenge",
      );
    }
  });

  it("decodes non-ASCII passwords as UTF-8, not latin-1", async () => {
    const password = "pässwörd-ü";
    expect(basicAuthPassword(basic("puls", password))).toBe(password);
    expect(await authorize({ pathname: "/", authorization: basic("puls", password), password })).toBe(
      "allow",
    );
  });

  it("keeps colons in the password (only the first splits user from password)", () => {
    expect(basicAuthPassword(basic("puls", "a:b:c"))).toBe("a:b:c");
  });

  it("compares in constant time and still gets the answer right", async () => {
    expect(await constantTimeEquals("abc", "abc")).toBe(true);
    expect(await constantTimeEquals("abc", "abd")).toBe(false);
    expect(await constantTimeEquals("", "")).toBe(true);
    expect(await constantTimeEquals("", "x")).toBe(false);
    expect(await constantTimeEquals("long".repeat(100), "long".repeat(100))).toBe(true);
    expect(await constantTimeEquals("long".repeat(100), "long".repeat(99) + "longg")).toBe(false);
  });
});
