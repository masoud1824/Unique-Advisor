import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { duplicateRequest, filesAvailability, nextStatusCheck, statusFromProvider, statusUrl } from "./signature-status.ts";

describe("signature status fallback", () => {
  it("reads provider status without treating a webhook as delivered", () => {
    assert.equal(statusFromProvider({ signatures: [{ status_code: "awaiting_signature" }] }), "sent");
    assert.equal(statusFromProvider({ signatures: [{ status_code: "awaiting_signature", last_viewed_at: 10 }] }), "viewed");
    assert.equal(statusFromProvider({ signatures: [{ status_code: "signed" }, { status_code: "awaiting_signature" }] }), "partially_signed");
    assert.equal(statusFromProvider({ is_complete: true, signatures: [{ status_code: "signed" }] }), "completed");
    assert.equal(statusFromProvider({ is_declined: true }), "declined");
    assert.equal(statusFromProvider({ has_error: true }), "failed");
    assert.equal(statusUrl("req 1").includes("/signature_request/send"), false);
    assert.equal(statusUrl("req 1"), "https://api.hellosign.com/v3/signature_request/req%201");
  });

  it("waits for files and backs off on the documented rate limit", () => {
    assert.equal(filesAvailability(200), "ready");
    assert.equal(filesAvailability(409), "preparing");
    assert.equal(filesAvailability(429), "limited");
    const now = 1_700_000_000_000;
    assert.equal(nextStatusCheck({ attempts: 0, httpStatus: 200, now }), now + 60_000);
    assert.equal(nextStatusCheck({ attempts: 3, httpStatus: 200, now }), now + 480_000);
    assert.equal(nextStatusCheck({ attempts: 8, httpStatus: 200, now }), now + 600_000);
    assert.equal(nextStatusCheck({ attempts: 1, httpStatus: 429, resetUnix: 1_700_000_100, now }), 1_700_000_100_000);
    assert.equal(duplicateRequest("same", "same"), true);
    assert.equal(duplicateRequest("same", "other"), false);
  });
});
