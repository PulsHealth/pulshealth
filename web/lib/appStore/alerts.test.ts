import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload } from "@apple/app-store-server-library";

const mocks = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn() }));
vi.mock("../db", () => ({ transaction: (fn: (q: typeof mocks.query) => Promise<void>) => fn(mocks.query) }));
vi.mock("../email", () => ({ mailConfig: () => ({ from: "alerts@example.com" }), sendMail: mocks.send }));
import { alertFor, deliverAlert, MAX_EVENT_AGE } from "./alerts";

const now = Date.UTC(2026, 9, 19);
const n = (type = "SUBSCRIBED", subtype?: string): ResponseBodyV2DecodedPayload => ({ notificationType: type, subtype, notificationUUID: "865612ea-3d6a-42f0-b8a6-e0684df76f31", signedDate: now });
const t = (extra: Partial<JWSTransactionDecodedPayload> = {}): JWSTransactionDecodedPayload => ({ transactionId: "1234", productId: "com.pulsHealth.PulsHealth.pro.monthly", price: 1990, currency: "USD", inAppOwnershipType: "PURCHASED", ...extra });

describe("App Store operator alerts", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("WEB_APP_STORE_ALERT_TO", "operator@example.com"); });
  it("converts milliunits and distinguishes customer price from earnings", () => {
    const a = alertFor(n(), t(), false, now)!;
    expect(a.subject).toContain("Subscription started");
    expect(a.text).toContain("$1.99");
    expect(a.text).toContain("not your net earnings");
    expect(a.text).not.toContain("1234");
    expect(a.text).not.toContain("865612ea");
  });
  it("deduplicates a transaction across notification UUIDs, but separates event kinds", () => {
    const a = alertFor(n(), t(), false, now)!;
    expect(alertFor({ ...n(), notificationUUID: "different" }, t(), false, now)!.key).toEqual(a.key);
    expect(alertFor(n("REFUND"), t(), false, now)!.key).not.toEqual(a.key);
  });
  it("labels free offers, lifetime purchases, renewals and billing failures accurately", () => {
    expect(alertFor(n(), t({ price: 0 }), false, now)!.subject).toContain("Free subscription");
    expect(alertFor(n("ONE_TIME_CHARGE"), t({ productId: "com.pulsHealth.PulsHealth.pro.lifetime" }), false, now)!.subject).toContain("Lifetime purchase");
    expect(alertFor(n("DID_RENEW"), t(), false, now)!.subject).toContain("renewed");
    expect(alertFor(n("DID_FAIL_TO_RENEW"), t(), false, now)!.subject).toContain("billing problem");
    expect(alertFor(n("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED"), t(), false, now)!.text).toContain("Access continues");
  });
  it("suppresses sandbox revenue, Family Sharing, unknown products, old/future events and unsupported events", () => {
    expect(alertFor(n(), t(), true, now)).toBeNull();
    expect(alertFor(n(), t({ inAppOwnershipType: "FAMILY_SHARED" }), false, now)).toBeNull();
    expect(alertFor(n(), t({ productId: "unknown" }), false, now)).toBeNull();
    expect(alertFor(n(), null, false, now)).toBeNull();
    expect(alertFor({ ...n(), signedDate: now - MAX_EVENT_AGE - 1 }, t(), false, now)).toBeNull();
    expect(alertFor({ ...n(), signedDate: now + 300_001 }, t(), false, now)).toBeNull();
    expect(alertFor(n("RENEWAL_EXTENDED"), t(), false, now)).toBeNull();
    expect(alertFor(n("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_ENABLED"), t(), false, now)).toBeNull();
  });
  it("delivers clearly labeled Apple TEST notifications without a transaction", () => {
    const a = alertFor(n("TEST"), null, true, now)!;
    expect(a.subject).toContain("[SANDBOX]");
    expect(a.text).toContain("No customer purchase");
  });
  it("sends once while holding a delivery row lock", async () => {
    mocks.query.mockResolvedValue([{ sent_at: null }]);
    mocks.send.mockResolvedValue(true);
    await deliverAlert(alertFor(n(), t(), false, now)!);
    expect(mocks.query.mock.calls[2][0]).toContain("FOR UPDATE");
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "operator@example.com" }), expect.anything());
    expect(mocks.query.mock.calls[3][0]).toContain("SET sent_at");
    mocks.query.mockResolvedValue([{ sent_at: new Date() }]);
    await deliverAlert(alertFor(n(), t(), false, now)!);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("throws on email failure so the database rolls back and Apple retries", async () => {
    mocks.query.mockResolvedValue([{ sent_at: null }]);
    mocks.send.mockResolvedValue(false);
    await expect(deliverAlert(alertFor(n(), t(), false, now)!)).rejects.toThrow("send failed");
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });
});
