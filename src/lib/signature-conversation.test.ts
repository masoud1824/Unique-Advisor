import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvedSignaturePayload, asksForTestSignature, PLACEMENT_NOT_CHOSEN, preparedDraftPreviewText, preparedDraftPath, selectPreparedDraft, signaturePreviewPayload, signaturePreviewText } from "./signature-conversation.ts";
import { signatureIntent } from "./signature-request.ts";

describe("signature conversation", () => {
  it("previews the test document before any approval and refuses a different document", () => {
    assert.equal(asksForTestSignature("Please prepare the TEST ONLY document for signature"), true);
    assert.equal(asksForTestSignature("Send the client application for signature"), false);
    const preview = signaturePreviewText();
    assert.match(preview, /Document: TEST ONLY/);
    assert.match(preview, /reviewer@example.invalid/);
    assert.match(preview, /One signature field/);
    assert.match(preview, /\/Unique Advisor\/Dropbox Sign Test/);
    assert.match(preview, /Nothing is sent until you approve/);
    const payload = signaturePreviewPayload();
    assert.equal(approvedSignaturePayload(payload), true);
    assert.equal(approvedSignaturePayload({ ...payload, signerEmail: "someone-else@example.com" }), false);
    assert.equal(signatureIntent("Prepare a signature preview for the prepared draft"), "preview");
    assert.equal(asksForTestSignature("Prepare a signature preview for the prepared draft"), false);
    const prepared = preparedDraftPreviewText({ path: preparedDraftPath(), edition: "LP257 6/26", placement: PLACEMENT_NOT_CHOSEN });
    assert.match(prepared, /LP257-6-26-C-1001-prepared-draft\.pdf/);
    assert.match(prepared, /Test signer <reviewer@example.invalid>/);
    assert.match(prepared, /not chosen/);
    assert.match(prepared, /not the earlier TEST ONLY request/);
    assert.match(prepared, /Nothing was sent/);
    assert.equal(prepared.includes("Nothing is sent until you approve this exact preview."), false);
    assert.equal(selectPreparedDraft([{ name: "older.pdf" }, { name: "LP257-6-26-C-1001-prepared-draft.pdf" }])?.name, "LP257-6-26-C-1001-prepared-draft.pdf");
    assert.equal(approvedSignaturePayload({ ...payload, documentId: "lp257-c1001-prepared-draft" }), false);
  });
});
