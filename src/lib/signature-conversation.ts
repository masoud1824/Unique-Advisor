import { signatureIntent } from "./signature-request.ts";
import { SIGNATURE_TEST } from "./signature-test-preview.ts";

export const SIGNATURE_PREVIEW_FINGERPRINT = "test-only-v1";

export function asksForTestSignature(text: string) {
  const tidy = String(text || "").replace(/\s+/g, " ").trim();
  if (/\b(?:do not|don't|never)\s+(?:send|file|save)\b/i.test(tidy)) return false;
  if (signatureIntent(tidy) === "status" || signatureIntent(tidy) === "file") return false;
  const namesTest = /\b(?:test only|system test|test signature|test document|dropbox sign test)\b/i.test(tidy);
  const asks = /\b(?:send|prepare|start|sign)\b/i.test(tidy) || /\bfor signature\b/i.test(tidy);
  return namesTest && asks;
}

export function approvesExactPreview(text: string) {
  return /^(?:yes|yeah|yep|approve|approved|i approve(?: this exact(?: test)? preview)?|send it)\b[.!]?$/i.test(String(text || "").trim());
}

export function signaturePreviewWaiting(text: string) {
  return text.includes("Nothing is sent until you approve this exact preview.")
    && text.includes(SIGNATURE_TEST.signerEmail)
    && text.includes(SIGNATURE_TEST.folder);
}

export function signaturePreviewText(already = "") {
  return [
    `Document: ${SIGNATURE_TEST.title}`,
    SIGNATURE_TEST.statement,
    "One signature field on page 1.",
    `Signer: ${SIGNATURE_TEST.signerName} <${SIGNATURE_TEST.signerEmail}>`,
    "Mode: Dropbox Sign test mode",
    `Destination: ${SIGNATURE_TEST.folder}`,
    "Completed files will use new names only. Existing files are not replaced.",
    already,
    "Nothing is sent until you approve this exact preview.",
  ].filter(Boolean).join("\n");
}

export function signaturePreviewPayload(already = "") {
  return {
    fingerprint: SIGNATURE_PREVIEW_FINGERPRINT,
    documentId: SIGNATURE_TEST.documentId,
    title: SIGNATURE_TEST.title,
    statement: SIGNATURE_TEST.statement,
    signerName: SIGNATURE_TEST.signerName,
    signerEmail: SIGNATURE_TEST.signerEmail,
    field: "signature",
    page: SIGNATURE_TEST.field.page,
    folder: SIGNATURE_TEST.folder,
    testMode: true,
    preview: signaturePreviewText(already),
  };
}

export const PREPARED_DRAFT = {
  documentId: "lp257-c1001-prepared-draft",
  fileName: "LP257-6-26-C-1001-prepared-draft.pdf",
  folder: "/Unique Advisor/Assistant Test/C-1001",
  signerName: "Test signer",
  signerEmail: "reviewer@example.invalid",
};

export function preparedDraftPath() {
  return `${PREPARED_DRAFT.folder}/${PREPARED_DRAFT.fileName}`;
}

export function selectPreparedDraft<T extends { name: string }>(files: T[]) {
  const matches = files.filter((file) => file.name === PREPARED_DRAFT.fileName);
  return matches.length === 1 ? matches[0] : null;
}

export function preparedDraftPreviewText(input: { path: string; edition: string; placement: string }) {
  return [
    `Document: ${input.path}`,
    `Edition from the visible footer: ${input.edition}`,
    "Proposed insured: Alex Example. You confirmed that role, and first name Alex with last name Example, in your own message. The source files only say “Name: Alex Example”.",
    `Test signer: ${PREPARED_DRAFT.signerName} <${PREPARED_DRAFT.signerEmail}>`,
    "That address is the approved test recipient. It is not alex.example@test.invalid, and Alex is not the signer on this request.",
    "Mode: Dropbox Sign test mode",
    input.placement,
    `Destination: ${PREPARED_DRAFT.folder}`,
    "A completed copy would be a new file in that folder. The prepared draft and the older draft would not be replaced.",
    "This is not the earlier TEST ONLY request.",
    "Nothing was sent. Tell me if the document, the box, the test signer, or the destination should change.",
  ].join("\n");
}

export const PLACEMENT_NOT_CHOSEN = "Signature placement: not chosen. Draw the box on this PDF. “Signed at (city)” is not a signature field and was not used.";

export function approvedSignaturePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const row = payload as { fingerprint?: string; documentId?: string; signerEmail?: string; folder?: string; testMode?: boolean; field?: string };
  return row.fingerprint === SIGNATURE_PREVIEW_FINGERPRINT
    && row.documentId === SIGNATURE_TEST.documentId
    && row.signerEmail === SIGNATURE_TEST.signerEmail
    && row.folder === SIGNATURE_TEST.folder
    && row.field === "signature"
    && row.testMode === true;
}
