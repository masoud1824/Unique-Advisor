import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signatureIntent } from "./signature-request.ts";
import { asksForTestSignature } from "./signature-conversation.ts";

describe("prepared draft stays off the old test request", () => {
  it("keeps the earlier test-only wording on its own path", () => {
    assert.equal(signatureIntent("Please prepare the TEST ONLY document for signature"), "preview");
    assert.equal(asksForTestSignature("Please prepare the TEST ONLY document for signature"), true);
    assert.equal(signatureIntent("Send this to the client for signature"), "send");
  });
});
