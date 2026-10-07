// The account page (app/account/page.tsx) for the shared demo account,
// rendered to HTML: what it is and the way out, and none of the account's
// own sections — no email, browsers, devices, assistants, password or
// deletion, and none of their lookups.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({ currentSession: vi.fn() }));
const lookups = vi.hoisted(() => ({ listSessions: vi.fn(), myDevices: vi.fn(), listConnectedApps: vi.fn() }));
vi.mock("@/lib/viewer", () => viewer);
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/accounts/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  listSessions: lookups.listSessions,
}));
vi.mock("@/lib/accounts/signups", async (importOriginal) => ({ ...(await importOriginal<typeof import("./signups")>()), myDevices: lookups.myDevices }));
vi.mock("@/lib/oauth/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../oauth/store")>()),
  listConnectedApps: lookups.listConnectedApps,
}));

const DEMO = {
  id: Buffer.alloc(32, 3),
  accountId: "00000000-0000-4000-8000-000000000001",
  userId: "0d3a0000-0000-4000-8000-0000000000ab",
  email: "demo@demo.invalid",
  isAdmin: false,
  selfService: false,
  demo: true,
  refreshed: false,
};

const saved = { ...process.env };
beforeAll(() => {
  process.env.WEB_ACCOUNTS = "true";
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  viewer.currentSession.mockReset().mockResolvedValue(DEMO);
  for (const fn of Object.values(lookups)) fn.mockReset();
  delete process.env.WEB_SIGNUPS;
});

async function render(query: Record<string, string> = {}): Promise<string> {
  const { default: AccountPage } = await import("@/app/account/page");
  const element = await AccountPage({ searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(createElement(() => element));
}

describe("the account page for a demo session", () => {
  it("says what the account is and offers only signing out", async () => {
    const html = await render();
    expect(html).toContain("Demo account");
    expect(html).toContain("sample data, not a real person&#x27;s");
    expect(html).toContain('action="/api/auth/logout"');
    for (const absent of ["demo@demo.invalid", "/api/auth/password", "/api/auth/sessions", "/api/auth/devices", "/api/auth/assistants", "/api/auth/delete-account", 'href="/signup"']) {
      expect(html, absent).not.toContain(absent);
    }
    for (const fn of Object.values(lookups)) expect(fn).not.toHaveBeenCalled();
  });

  it("links to sign-up when it is open, and shows why a change was refused", async () => {
    process.env.WEB_SIGNUPS = "true";
    const html = await render({ error: "demo" });
    expect(html).toContain('href="/signup"');
    expect(html).toContain("Not available on the demo account");
  });
});
