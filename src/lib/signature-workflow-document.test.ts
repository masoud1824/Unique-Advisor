import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseDropboxDocument, workflowPreviewText, workflowSignField } from "./signature-workflow-document.ts";

const files = [
  { name: "LP257-6-26-C-1001-prepared-draft.pdf", path: "/Unique Advisor/Assistant Test/C-1001/LP257-6-26-C-1001-prepared-draft.pdf" },
  { name: "TEST ONLY.pdf", path: "/Unique Advisor/Dropbox Sign Test/TEST ONLY.pdf" },
  { name: "Signature Workflow Test.pdf", path: "/Unique Advisor/Assistant Test/Signature Workflow Test.pdf" },
];

describe("general Dropbox document choice", () => {
  it("selects the titled workflow file and leaves the old test unused", () => {
    const chosen = chooseDropboxDocument(files, "Signature Workflow Test");
    assert.equal(chosen.ok, true);
    if (!chosen.ok) return;
    assert.equal(chosen.file.name, "Signature Workflow Test.pdf");
    assert.equal(chooseDropboxDocument(files, "TEST ONLY").ok, false);
    assert.equal(chooseDropboxDocument(files, "LP257").ok, false);
    const field = workflowSignField();
    const preview = workflowPreviewText({ path: chosen.file.path, field });
    assert.match(preview, /masoudz@outlook.com/);
    assert.match(preview, /Dropbox Sign test mode/);
    assert.match(preview, /labelled Signature/);
    assert.match(preview, /page 1, x 72, y 628, width 240, height 48/);
    assert.match(preview, /Nothing was sent/);
    assert.equal(preview.includes("test-only"), false);
    assert.equal(preview.includes("/Unique Advisor/Dropbox Sign Test"), false);
  });
});
