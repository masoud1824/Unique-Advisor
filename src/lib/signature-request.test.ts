import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCalendarAsk, taskKind } from "./advisor-intent.ts";
import { applySandboxNotice, createSandbox, fileSignedCopy, missingSignatureProviderMessage, prepareSignature, reminderAllowed, sendSandbox, signatureStatus, type SignatureDraft } from "./signature-request.ts";

const draft: SignatureDraft = {
  advisorId: "4",
  documentId: "application",
  version: "v3",
  signers: [
    { name: "Alex Example", email: "alex.example@test.invalid", order: 1 },
    { name: "Jordan Example", email: "jordan.example@test.invalid", order: 2 },
  ],
  fields: [
    { signer: "alex.example@test.invalid", kind: "signature", placement: "placed" },
    { signer: "alex.example@test.invalid", kind: "date", placement: "placed" },
    { signer: "jordan.example@test.invalid", kind: "initial", placement: "placed" },
  ],
  message: "Please sign the application.",
  storage: "dropbox",
  folder: "/Clients/C-1001",
};

describe("signature requests", () => {
  it("understands the three requests and does not steal a calendar read", () => {
    assert.equal(taskKind("Send this to the client for signature"), "signature");
    assert.equal(taskKind("Has Jordan signed yet?"), "signature");
    assert.equal(taskKind("Save the signed copy in their folder"), "signature");
    assert.equal(taskKind("Do not send this for signature"), "");
    const calendar = "Show my existing Outlook appointments for Monday, November 16, 2026, in Toronto time.";
    assert.equal(isCalendarAsk(calendar), true);
    assert.equal(taskKind(calendar), "calendar");
    assert.match(missingSignatureProviderMessage(), /Dropbox Sign is not connected/);
    assert.match(missingSignatureProviderMessage(), /did not send/i);
    assert.match(missingSignatureProviderMessage(), /OneDrive/);
  });

  it("refuses unclear fields, shows one confirmation, and withdraws it when signers change", () => {
    const prepared = prepareSignature(draft);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.match(prepared.preview, /alex\.example@test\.invalid/);
    assert.match(prepared.preview, /jordan\.example@test\.invalid/);
    assert.match(prepared.preview, /dropbox:\/Clients\/C-1001/);
    assert.match(prepared.preview, /will not sign for anyone/i);
    const unclear = prepareSignature({ ...draft, fields: [{ signer: "alex.example@test.invalid", kind: "signature", placement: "unclear" }] });
    assert.equal(unclear.ok, false);
    const unordered = prepareSignature({ ...draft, signers: draft.signers.map((signer) => ({ ...signer, order: 1 })) });
    assert.equal(unordered.ok, false);
    const changed = prepareSignature({ ...draft, version: "v4" });
    assert.equal(changed.ok, true);
    if (changed.ok) assert.notEqual(changed.fingerprint, prepared.fingerprint);
    const onedrive = prepareSignature({ ...draft, storage: "onedrive" });
    assert.equal(onedrive.ok, false);
  });

  it("sends once through the sandbox, tracks every signer, and files only after completion", () => {
    const state = createSandbox("4");
    const prepared = prepareSignature(draft);
    if (!prepared.ok) return;
    const sent = sendSandbox(state, draft, prepared.fingerprint);
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    const again = sendSandbox(state, draft, prepared.fingerprint);
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.requestId, sent.requestId);
    assert.match(again.error, /did not send it again/i);
    const expired = sendSandbox({ ...createSandbox("4"), expired: true }, draft, prepared.fingerprint);
    assert.equal(expired.ok, false);
    assert.match(expired.ok ? "" : expired.error, /expired/i);
    const viewed = applySandboxNotice(state, "4", sent.requestId, "viewed");
    assert.equal(viewed.ok && viewed.status, "viewed");
    const repeat = applySandboxNotice(state, "4", sent.requestId, "viewed");
    assert.equal(repeat.ok && repeat.duplicate, true);
    const partial = applySandboxNotice(state, "4", sent.requestId, "signed", "alex.example@test.invalid");
    assert.equal(partial.ok && partial.status, "partially_signed");
    const early = fileSignedCopy(state, "4", sent.requestId, ["application-original.pdf"], true);
    assert.equal(early.filed, false);
    const done = applySandboxNotice(state, "4", sent.requestId, "signed", "jordan.example@test.invalid");
    assert.equal(done.ok && done.status, "completed");
    assert.match(done.ok ? done.notify : "", /completed/);
    const failedFile = fileSignedCopy(state, "4", sent.requestId, ["application-original.pdf"], false);
    assert.equal(failedFile.filed, false);
    assert.equal(failedFile.requestId, sent.requestId);
    assert.match(failedFile.ok ? "" : failedFile.error, /not sent again/i);
    const filed = fileSignedCopy(state, "4", sent.requestId, ["application-original.pdf", "application-signed-sbx-application-1.pdf"], true);
    assert.equal(filed.ok, true);
    if (!filed.ok) return;
    assert.equal(filed.files.some((name) => name.endsWith("application-original.pdf")), false);
    assert.equal(filed.files.length, 2);
    const second = fileSignedCopy(state, "4", sent.requestId, [], true);
    assert.equal(second.ok && "duplicate" in second && second.duplicate, true);
    assert.equal(signatureStatus(state, "9", sent.requestId).ok, false);
    const other = createSandbox("9");
    const declined = sendSandbox(other, { ...draft, advisorId: "9", documentId: "declined-copy" }, prepareSignature({ ...draft, advisorId: "9", documentId: "declined-copy" }).ok ? (prepareSignature({ ...draft, advisorId: "9", documentId: "declined-copy" }) as { fingerprint: string }).fingerprint : "");
    assert.equal(declined.ok, true);
    if (!declined.ok) return;
    const notice = applySandboxNotice(other, "9", declined.requestId, "declined");
    assert.equal(notice.ok && notice.status, "declined");
    assert.equal(reminderAllowed(false).ok, false);
    assert.match(state.requests[0].history.join("\n"), /approved application v3/);
    assert.match(state.requests[0].history.join("\n"), new RegExp(sent.requestId));
  });
});
