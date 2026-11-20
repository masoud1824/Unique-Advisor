import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropboxWebLink, planSignatureNotices } from "./signature-notices.ts";

const completed = {
  documentId: "test-only",
  folder: "/Unique Advisor/Dropbox Sign Test",
  completed: true,
  signedPath: "/Unique Advisor/Dropbox Sign Test/test-only-signed-89f9133b3cc12967c5b9cebc38bf8cf42104e20f.pdf",
  auditPath: "/Unique Advisor/Dropbox Sign Test/test-only-audit-89f9133b3cc12967c5b9cebc38bf8cf42104e20f.pdf",
};

describe("signature notices", () => {
  it("combines signing and filing when they finish together and does not repeat them", () => {
    const first = planSignatureNotices({ ...completed, filedSigned: true, filedAudit: true, filingFailed: false, existingKinds: [] });
    assert.deepEqual(first.map((item) => item.kind), ["signed-filed"]);
    assert.match(first[0].body, /fully signed/);
    assert.match(first[0].body, /\/Unique Advisor\/Dropbox Sign Test/);
    assert.match(first[0].body, /test-only-signed-89f9133b3cc12967c5b9cebc38bf8cf42104e20f\.pdf/);
    assert.match(first[0].body, /test-only-audit-89f9133b3cc12967c5b9cebc38bf8cf42104e20f\.pdf/);
    const again = planSignatureNotices({ ...completed, filedSigned: true, filedAudit: true, filingFailed: false, existingKinds: ["signed-filed"] });
    assert.deepEqual(again, []);
    const link = dropboxWebLink(completed.signedPath);
    assert.equal(link.includes("preview=test-only-signed-89f9133b3cc12967c5b9cebc38bf8cf42104e20f.pdf"), true);
    assert.equal(link.startsWith("https://www.dropbox.com/home/"), true);
  });

  it("keeps a later filing notice separate and does not notify a second time", () => {
    const signed = planSignatureNotices({ ...completed, filedSigned: false, filedAudit: false, filingFailed: false, existingKinds: [] });
    assert.deepEqual(signed.map((item) => item.kind), ["signed"]);
    const filed = planSignatureNotices({ ...completed, filedSigned: true, filedAudit: true, filingFailed: false, existingKinds: ["signed"] });
    assert.deepEqual(filed.map((item) => item.kind), ["filed"]);
    const repeat = planSignatureNotices({ ...completed, filedSigned: true, filedAudit: true, filingFailed: false, existingKinds: ["signed", "filed"] });
    assert.deepEqual(repeat, []);
  });

  it("says saving failed and offers a filing retry without another signature request", () => {
    const failed = planSignatureNotices({ ...completed, filedSigned: false, filedAudit: false, filingFailed: true, existingKinds: [] });
    assert.deepEqual(failed.map((item) => item.kind), ["filing-failed"]);
    assert.match(failed[0].body, /Signed successfully; saving failed/);
    assert.match(failed[0].body, /without sending the signature request again/);
    assert.doesNotMatch(failed[0].body, /sent again|new signature request/i);
    const held = planSignatureNotices({ ...completed, filedSigned: false, filedAudit: false, filingFailed: true, existingKinds: ["filing-failed"] });
    assert.deepEqual(held, []);
    const recovered = planSignatureNotices({ ...completed, filedSigned: true, filedAudit: true, filingFailed: false, existingKinds: ["filing-failed"] });
    assert.deepEqual(recovered.map((item) => item.kind), ["filed"]);
    assert.match(recovered[0].body, /saved in \/Unique Advisor\/Dropbox Sign Test/);
  });

  it("backfills the completed test as one notice", () => {
    const notice = planSignatureNotices({ ...completed, filedSigned: true, filedAudit: true, filingFailed: false, existingKinds: [], backfill: true });
    assert.deepEqual(notice.map((item) => item.kind), ["signed-filed"]);
  });
});
