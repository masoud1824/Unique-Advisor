import { findAdvisorBySlug } from "@/lib/advisor-db";
import { accessToken, prepareLink } from "@/lib/advisor-links";
import { getSql } from "@/lib/db";
import { DROPBOX_SIGN_SEND, readSendResult, sendPayload } from "@/lib/dropbox-sign";
import { ensureSignatureRequests, startSignatureWatch } from "@/lib/signature-watch";
import { WORKFLOW_DOCUMENT, workflowDocumentPath, workflowSignField, workflowSignRequest } from "@/lib/signature-workflow-document";
import { readSelectedWorkflow } from "@/lib/signature-workflow-live";
import { previewWritesBlocked } from "@/lib/preview-readonly";
import { externalSideEffectsBlocked, ISOLATED_EXTERNAL_BLOCK } from "@/lib/isolated-test-desk";

const ADVISOR = "masoud-zangeneh-2";
const PENDING = "pending-signature-workflow-test";

function refusal(status: number, text: string) {
  let message = text.replace(/\s+/g, " ").slice(0, 160);
  try {
    const json = JSON.parse(text) as { error?: { error_msg?: string } };
    message = String(json.error?.error_msg || message);
  } catch { /* keep the short text */ }
  return `Dropbox Sign did not accept the request (HTTP ${status}). ${message}`.replace(/\s+/g, " ").slice(0, 240);
}

export async function sendApprovedWorkflowDocument() {
  if (previewWritesBlocked() || externalSideEffectsBlocked()) {
    return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK };
  }
  const advisor = await findAdvisorBySlug(ADVISOR);
  if (!advisor) return { ok: false as const, error: "The advisor was not found. Nothing was sent." };
  await ensureSignatureRequests();
  const sql = await getSql();
  const existing = await sql<{ request_id: string }>`
    select request_id from signature_requests
    where advisor_id = ${advisor.id} and document_id = ${WORKFLOW_DOCUMENT.documentId}
    limit 1
  `;
  if (existing[0]?.request_id && existing[0].request_id !== PENDING) {
    return { ok: true as const, already: true, requestId: existing[0].request_id, testMode: true };
  }
  if (existing[0]?.request_id === PENDING) return { ok: false as const, error: "A send is already in progress. It was not sent again." };
  const saved = await sql<{ emails: string }>`select emails from signature_test_signers where advisor_id = ${advisor.id}`;
  const allowed = String(saved[0]?.emails || "").split(/[\s,;]+/).map((email) => email.trim().toLowerCase());
  if (!allowed.includes(WORKFLOW_DOCUMENT.signerEmail)) return { ok: false as const, error: "The approved test recipient is not saved for this advisor. Nothing was sent." };
  const dropbox = await accessToken(advisor.id, "dropbox");
  if (!dropbox) return { ok: false as const, error: "Dropbox is not connected. Nothing was sent." };
  const selected = await readSelectedWorkflow(dropbox);
  if (!selected.ok || !("bytes" in selected)) return { ok: false as const, error: "error" in selected ? selected.error : "The document was not selected. Nothing was sent." };
  if (selected.path !== workflowDocumentPath()) return { ok: false as const, error: "The selected file is not the approved document. Nothing was sent." };
  const field = workflowSignField();
  if (selected.field.page !== field.page || selected.field.x !== field.x || selected.field.y !== field.y || selected.field.width !== field.width || selected.field.height !== field.height) {
    return { ok: false as const, error: "The signature area does not match the approved preview. Nothing was sent." };
  }
  const config = await prepareLink("dropbox_sign");
  if (!config?.clientId) return { ok: false as const, error: "The Dropbox Sign app is not saved. Nothing was sent." };
  const token = await accessToken(advisor.id, "dropbox_sign");
  if (!token) return { ok: false as const, error: "Dropbox Sign is not connected. Nothing was sent." };
  const request = workflowSignRequest(String(advisor.id));
  const built = sendPayload(request, config.clientId);
  if (!built.ok) return built;
  built.form.append("file[0]", new Blob([Buffer.from(selected.bytes)], { type: "application/pdf" }), WORKFLOW_DOCUMENT.fileName);
  try {
    await sql`
      insert into signature_requests (advisor_id, request_id, document_id, version, fingerprint, folder, storage, status, next_check_at)
      values (${advisor.id}, ${PENDING}, ${WORKFLOW_DOCUMENT.documentId}, ${"1"}, ${"approved-signature-workflow-test"}, ${WORKFLOW_DOCUMENT.folder}, ${"dropbox"}, ${"sending"}, ${Date.now() + 60 * 60 * 1000})
    `;
  } catch {
    return { ok: false as const, error: "A send is already in progress. It was not sent again." };
  }
  try {
    const response = await fetch(DROPBOX_SIGN_SEND, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: built.form });
    const text = await response.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = null; }
    const result = readSendResult(response.status, body);
    if (!result.ok) {
      await sql`delete from signature_requests where advisor_id = ${advisor.id} and request_id = ${PENDING}`;
      return { ok: false as const, error: refusal(response.status, text) };
    }
    const record = body && typeof body === "object" ? body as { signature_request?: { test_mode?: boolean; signatures?: Array<{ signer_email_address?: string }> } } : {};
    const testMode = record.signature_request?.test_mode === true;
    const recipient = String(record.signature_request?.signatures?.[0]?.signer_email_address || "").toLowerCase();
    if (!testMode || recipient !== WORKFLOW_DOCUMENT.signerEmail) {
      await fetch(`https://api.hellosign.com/v3/signature_request/cancel/${encodeURIComponent(result.requestId)}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
      await sql`delete from signature_requests where advisor_id = ${advisor.id} and request_id = ${PENDING}`;
      return { ok: false as const, error: "The request was not kept. It was not in test mode for the approved recipient." };
    }
    await sql`
      update signature_requests
      set request_id = ${result.requestId}, status = ${"sent"}, next_check_at = ${Date.now()}, last_error = ${""}
      where advisor_id = ${advisor.id} and request_id = ${PENDING}
    `;
    startSignatureWatch();
    return { ok: true as const, already: false, requestId: result.requestId, testMode: true, path: selected.path, recipient };
  } catch (error) {
    await sql`delete from signature_requests where advisor_id = ${advisor.id} and request_id = ${PENDING}`;
    return { ok: false as const, error: error instanceof Error ? error.message.slice(0, 200) : "The request could not be sent." };
  }
}
