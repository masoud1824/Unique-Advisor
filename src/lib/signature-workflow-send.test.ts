import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workflowSignRequest } from "./signature-workflow-document.ts";
import { documentLabel } from "./signature-notices.ts";

describe("signature workflow send", () => {
  it("uses the approved test recipient and not the old test document", () => {
    const request = workflowSignRequest("34");
    assert.equal(request.testMode, true);
    assert.equal(request.documentId, "signature-workflow-test");
    assert.equal(request.signers[0]?.email, "reviewer@example.invalid");
    assert.equal(request.fields[0]?.page, 1);
    assert.equal(request.fields[0]?.x, 72);
    assert.equal(request.fields[0]?.y, 628);
    assert.notEqual(request.documentId, "test-only");
    assert.equal(documentLabel(request.documentId), "Signature Workflow Test");
  });
});
