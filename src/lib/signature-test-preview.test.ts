import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIGNATURE_TEST, approvedTestForm, buildTestOnlyPdf, testFilingNames } from "./signature-test-preview.ts";

describe("signature test preview", () => {
  it("is one fictional page and does not reuse an existing filename", () => {
    const pdf = buildTestOnlyPdf();
    assert.equal(pdf.includes("TEST ONLY"), true);
    assert.equal(pdf.includes("This is a system test, not a client document."), true);
    assert.equal(pdf.includes("/Count 1"), true);
    assert.equal(SIGNATURE_TEST.testMode, true);
    assert.equal(SIGNATURE_TEST.signerEmail, "masoudz@outlook.com");
    assert.equal(SIGNATURE_TEST.folder, "/Unique Advisor/Dropbox Sign Test");
    assert.equal(SIGNATURE_TEST.field.page, 1);
    const names = testFilingNames("req_1");
    assert.equal(names.signed.endsWith(".pdf"), true);
    assert.equal(names.audit.endsWith(".zip"), true);
    assert.notEqual(names.signed, "client-file.pdf");
    const built = approvedTestForm("client-test");
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.form.get("test_mode"), "1");
    assert.equal(built.form.get("title"), "TEST ONLY");
    assert.equal(built.form.get("message"), SIGNATURE_TEST.statement);
    assert.equal(built.form.get("signers[0][email_address]"), "masoudz@outlook.com");
    assert.equal(built.form.getAll("signers[0][email_address]").length, 1);
    assert.equal(built.form.get("file[0]") instanceof Blob, true);
  });
});
