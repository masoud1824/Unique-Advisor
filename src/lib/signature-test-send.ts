import { createHash } from "node:crypto";
import { fictionalAddress } from "@/lib/signature-placement";
import { findAdvisorBySlug } from "@/lib/advisor-db";
import { accessToken, prepareLink } from "@/lib/advisor-links";
import { getSql } from "@/lib/db";
import { DROPBOX_SIGN_SEND, readSendResult } from "@/lib/dropbox-sign";
import { ensureSignatureRequests } from "@/lib/signature-watch";
import { SIGNATURE_TEST, approvedTestForm } from "@/lib/signature-test-preview";
import { approvedSignaturePayload } from "@/lib/signature-conversation";
import { externalSideEffectsBlocked, ISOLATED_EXTERNAL_BLOCK } from "@/lib/isolated-test-desk";
import { previewWritesBlocked } from "@/lib/preview-readonly";

function testFingerprint() {
  return createHash("sha256").update(JSON.stringify({
    title: SIGNATURE_TEST.title,
    statement: SIGNATURE_TEST.statement,
    email: SIGNATURE_TEST.signerEmail,
    folder: SIGNATURE_TEST.folder,
    field: SIGNATURE_TEST.field,
    testMode: true,
  })).digest("hex");
}

let sending: Promise<{ ok: true; requestId: string; testMode: boolean; already?: boolean } | { ok: false; error: string }> | null = null;

function refusal(status: number, text: string) {
  let name = "";
  let message = "";
  try {
    const json = JSON.parse(text) as { error?: { error_name?: string; error_msg?: string } | string; error_description?: string };
    if (json.error && typeof json.error === "object") {
      name = String(json.error.error_name || "");
      message = String(json.error.error_msg || "");
    } else if (typeof json.error === "string") {
      name = json.error;
      message = String(json.error_description || "");
    }
  } catch {
    message = text.replace(/\s+/g, " ").slice(0, 160);
  }
  return `Dropbox Sign did not accept the test request (HTTP ${[status, name].filter(Boolean).join(" ")}). ${message}`.replace(/\s+/g, " ").slice(0, 240);
}

async function sendOnce() {
  if (previewWritesBlocked() || externalSideEffectsBlocked()) {
    return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK };
  }
  const advisor = await findAdvisorBySlug(SIGNATURE_TEST.advisorSlug);
  if (!advisor) return { ok: false as const, error: "The test advisor was not found. Nothing was sent." };
  await ensureSignatureRequests();
  const sql = await getSql();
  const existing = await sql<{ request_id: string; status: string }>`
    select request_id, status from signature_requests
    where advisor_id = ${advisor.id} and document_id = ${SIGNATURE_TEST.documentId}
    limit 1
  `;
  if (existing[0]?.request_id && existing[0].request_id !== "pending-test-only") {
    return { ok: true as const, requestId: existing[0].request_id, testMode: true, already: true };
  }
  if (existing[0]?.request_id === "pending-test-only") {
    return { ok: false as const, error: "A test send is already in progress. It was not sent again." };
  }
  const saved = await sql<{ emails: string }>`
    select emails from signature_test_signers where advisor_id = ${advisor.id}
  `;
  const allowed = String(saved[0]?.emails || "").split(/[\s,;]+/).map((email) => email.trim().toLowerCase());
  if (!allowed.includes(SIGNATURE_TEST.signerEmail)) {
    return { ok: false as const, error: "The approved signer is not saved for this advisor. Nothing was sent." };
  }
  const config = await prepareLink("dropbox_sign");
  if (!config?.clientId) return { ok: false as const, error: "The Dropbox Sign app is not saved. Nothing was sent." };
  const token = await accessToken(advisor.id, "dropbox_sign");
  if (!token) return { ok: false as const, error: "Dropbox Sign is not connected for this advisor. Nothing was sent." };
  try {
    await sql`
      insert into signature_requests (advisor_id, request_id, document_id, version, fingerprint, folder, storage, status, next_check_at)
      values (${advisor.id}, ${"pending-test-only"}, ${SIGNATURE_TEST.documentId}, ${"1"}, ${testFingerprint()}, ${SIGNATURE_TEST.folder}, ${"dropbox"}, ${"sending"}, ${Date.now() + 60 * 60 * 1000})
    `;
  } catch {
    return { ok: false as const, error: "A test send is already in progress. It was not sent again." };
  }
  const built = approvedTestForm(config.clientId);
  if (!built.ok) {
    await sql`delete from signature_requests where advisor_id = ${advisor.id} and request_id = ${"pending-test-only"}`;
    return built;
  }
  built.form.set("metadata[advisor_id]", String(advisor.id));
  try {
    const response = await fetch(DROPBOX_SIGN_SEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: built.form,
    });
    const text = await response.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = null; }
    const result = readSendResult(response.status, body);
    if (!result.ok) {
      await sql`delete from signature_requests where advisor_id = ${advisor.id} and request_id = ${"pending-test-only"}`;
      return { ok: false as const, error: refusal(response.status, text) };
    }
    const record = body && typeof body === "object" ? body as { signature_request?: { test_mode?: boolean } } : {};
    const testMode = record.signature_request?.test_mode === true;
    if (!testMode) {
      await fetch(`https://api.hellosign.com/v3/signature_request/cancel/${encodeURIComponent(result.requestId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
      await sql`delete from signature_requests where advisor_id = ${advisor.id} and request_id = ${"pending-test-only"}`;
      return { ok: false as const, error: "Dropbox Sign did not mark the request as test mode. The request was cancelled and was not kept." };
    }
    await sql`
      update signature_requests
      set request_id = ${result.requestId}, status = ${"sent"}, next_check_at = ${Date.now()}, last_error = ${""}
      where advisor_id = ${advisor.id} and request_id = ${"pending-test-only"}
    `;
    return { ok: true as const, requestId: result.requestId, testMode: true };
  } catch (error) {
    await sql`delete from signature_requests where advisor_id = ${advisor.id} and request_id = ${"pending-test-only"}`;
    const message = error instanceof Error ? error.message : "The test request could not be sent.";
    return { ok: false as const, error: message.slice(0, 200) };
  }
}

export function sendApprovedSignatureTest() {
  if (!sending) sending = sendOnce().finally(() => { sending = null; });
  return sending;
}

export async function approveConversationSignature(payload: unknown) {
  const row = payload as { signerEmail?: string; deliveryEmail?: string; documentId?: string; signers?: Array<{ email?: string }> };
  if (row?.documentId === "lp257-c1001-prepared-draft") return { ok: false as const, error: "That preview is for review only. Nothing was sent." };
  const emails = [row?.signerEmail, row?.deliveryEmail, ...(row?.signers || []).map((signer) => signer.email)];
  if (emails.some((email) => fictionalAddress(String(email || "")))) {
    return { ok: false as const, error: "That email is fictional test data. I did not send to it. A delivery test must use your approved test email and a fresh preview." };
  }
  if (!approvedSignaturePayload(payload)) return { ok: false as const, error: "That approval does not match the preview. Nothing was sent." };
  const sent = await sendApprovedSignatureTest();
  if (!sent.ok) return sent;
  if (sent.already) return { ok: true as const, detail: `That test was already sent as ${sent.requestId}. I did not send it again.` };
  return { ok: true as const, detail: `Dropbox Sign accepted the test request ${sent.requestId}.` };
}
