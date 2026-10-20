import { beforeEach, describe, expect, it, vi } from "vitest";
import { VerificationException, VerificationStatus } from "@apple/app-store-server-library";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), transaction: vi.fn(), deliver: vi.fn(), configured: true }));
vi.mock("./verify", () => ({ verifierFor: () => ({ verifyAndDecodeNotification: mocks.verify, verifyAndDecodeTransaction: mocks.transaction }) }));
vi.mock("./alerts", async importOriginal => ({ ...await importOriginal<typeof import("./alerts")>(), deliverAlert: mocks.deliver }));
vi.mock("../email", () => ({ mailConfig: () => mocks.configured ? {} : null }));
vi.mock("../mode", () => ({ viewerMode: () => "accounts" }));
import { POST } from "../../app/api/app-store/notifications/[environment]/route";
const context = (environment = "production") => ({ params: Promise.resolve({ environment }) });
const request = (body: string) => new Request("https://viewer.example.com/api/app-store/notifications/production", { method: "POST", body });

describe("App Store webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("WEB_APP_STORE_ALERT_TO", "operator@example.com"); mocks.configured = true;
    mocks.verify.mockResolvedValue({ notificationType: "TEST", notificationUUID: "test-id", signedDate: Date.now() });
    mocks.deliver.mockResolvedValue(undefined);
  });
  it("is off by default and refuses unknown environment paths", async () => {
    vi.stubEnv("WEB_APP_STORE_ALERT_TO", "");
    expect((await POST(request("{}"), context())).status).toBe(404);
    vi.stubEnv("WEB_APP_STORE_ALERT_TO", "operator@example.com");
    expect((await POST(request("{}"), context("other"))).status).toBe(404);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("bounds input and rejects malformed payloads", async () => {
    for (const body of ["null", "{}", "bad json", '{"signedPayload":3}']) expect((await POST(request(body), context())).status).toBe(400);
    expect((await POST(request("x".repeat(128 * 1024 + 1)), context())).status).toBe(413);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("rejects forged/wrong-app/wrong-environment signatures without mailing", async () => {
    for (const status of [VerificationStatus.INVALID_APP_IDENTIFIER, VerificationStatus.INVALID_ENVIRONMENT, VerificationStatus.VERIFICATION_FAILURE]) {
      mocks.verify.mockRejectedValue(new VerificationException(status));
      expect((await POST(request('{"signedPayload":"forged"}'), context())).status).toBe(400);
    }
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("returns 503 on transient verification, missing mail configuration or send failure", async () => {
    const body = '{"signedPayload":"signed"}';
    mocks.configured = false;
    expect((await POST(request(body), context())).status).toBe(503);
    mocks.configured = true;
    mocks.verify.mockRejectedValueOnce(new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE));
    expect((await POST(request(body), context())).status).toBe(503);
    mocks.deliver.mockRejectedValueOnce(new Error("send failed"));
    expect((await POST(request(body), context())).status).toBe(503);
  });
  it("verifies the nested transaction before producing a purchase alert", async () => {
    mocks.verify.mockResolvedValue({ notificationType: "SUBSCRIBED", notificationUUID: "id", signedDate: Date.now(), data: { signedTransactionInfo: "inner-signed" } });
    mocks.transaction.mockRejectedValueOnce(new VerificationException(VerificationStatus.INVALID_ENVIRONMENT));
    expect((await POST(request('{"signedPayload":"outer-signed"}'), context())).status).toBe(400);
    expect(mocks.transaction).toHaveBeenCalledWith("inner-signed");
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("accepts verified TEST events and acknowledges irrelevant notifications", async () => {
    expect((await POST(request('{"signedPayload":"signed"}'), context())).status).toBe(200);
    expect(mocks.deliver).toHaveBeenCalledOnce();
    mocks.verify.mockResolvedValue({ notificationType: "UNHANDLED", notificationUUID: "id", signedDate: Date.now() });
    expect((await POST(request('{"signedPayload":"signed"}'), context())).status).toBe(200);
    expect(mocks.deliver).toHaveBeenCalledOnce();
  });
});
