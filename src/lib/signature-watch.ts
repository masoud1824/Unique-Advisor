import { accessToken } from "@/lib/advisor-links";
import { getSql } from "@/lib/db";
import { filesUrl } from "@/lib/dropbox-sign";
import { rememberSignatureOutcome, syncSignatureNotices } from "@/lib/signature-notice-store";
import { storeSignedFile } from "@/lib/signature-storage";
import { verifiedFolderId } from "@/lib/signature-workflow";
import { filesAvailability, nextStatusCheck, statusFromProvider, statusUrl, type SignatureProgress } from "@/lib/signature-status";
import { readSignatureStatus } from "@/lib/provider-integrations";
import { previewWritesBlocked } from "@/lib/preview-readonly";
import { externalSideEffectsBlocked, ISOLATED_EXTERNAL_BLOCK } from "@/lib/isolated-test-desk";

type Row = {
  advisor_id: number;
  request_id: string;
  document_id: string;
  folder: string;
  storage: string;
  status: string;
  filed_signed: string;
  filed_audit: string;
  attempts: number;
  signature_provider: string;
};

const globalWatch = globalThis as { __uaSignWatch?: boolean };

export async function ensureSignatureRequests() {
  const sql = await getSql();
  await sql.query(`create table if not exists signature_requests (
    advisor_id integer not null,
    request_id text not null,
    document_id text not null default '',
    version text not null default '',
    fingerprint text not null default '',
    folder text not null default '',
    storage text not null default 'dropbox',
    status text not null default 'sent',
    filed_signed text not null default '',
    filed_audit text not null default '',
    attempts integer not null default 0,
    next_check_at bigint not null default 0,
    last_error text not null default '',
    signature_provider text not null default 'dropbox_sign',
    primary key (advisor_id, request_id)
  )`);
  await sql.query("alter table signature_requests add column if not exists signature_provider text not null default 'dropbox_sign'");
}

export function startSignatureWatch() {
  if (process.env.UA_DATA_PLANE === "postgres") return;
  if (previewWritesBlocked() || externalSideEffectsBlocked()) return;
  if (globalWatch.__uaSignWatch) return;
  globalWatch.__uaSignWatch = true;
  setInterval(() => {
    void pollDueSignatures().catch(() => undefined);
  }, 60_000);
}

async function pendingRows(advisorId?: number) {
  await ensureSignatureRequests();
  const now = Date.now();
  if (advisorId) {
    return (await getSql())<Row>`
      select advisor_id, request_id, document_id, folder, storage, status, filed_signed, filed_audit, attempts, signature_provider, signature_provider
      from signature_requests
      where advisor_id = ${advisorId}
        and status not in ('declined', 'expired', 'failed')
        and not (status = 'completed' and filed_signed <> '' and filed_audit <> '')
      order by next_check_at asc
    `;
  }
  return (await getSql())<Row>`
    select advisor_id, request_id, document_id, folder, storage, status, filed_signed, filed_audit, attempts, signature_provider
    from signature_requests
    where next_check_at <= ${now}
      and status not in ('declined', 'expired', 'failed')
      and not (status = 'completed' and filed_signed <> '' and filed_audit <> '')
    order by next_check_at asc
    limit 1
  `;
}

async function saveProgress(row: Row, status: SignatureProgress, error: string, httpStatus: number, resetUnix?: number) {
  const attempts = row.attempts + 1;
  const next = nextStatusCheck({ attempts, httpStatus, resetUnix, now: Date.now() });
  await (await getSql())`
    update signature_requests
    set status = ${status}, attempts = ${attempts}, next_check_at = ${next}, last_error = ${error.slice(0, 240)}
    where advisor_id = ${row.advisor_id} and request_id = ${row.request_id}
  `;
}

async function fileCompleted(row: Row, signToken: string) {
  const empty = { filedSigned: false, filedAudit: false, filingFailed: false, signedPath: "", auditPath: "", detail: "" };
  if (row.storage !== "dropbox" && row.storage !== "box" && row.storage !== "google_drive" && row.storage !== "onedrive") {
    return { ...empty, filingFailed: true, detail: "That storage provider is not available. I did not use another storage provider. The signature request was not sent again." };
  }
  if (row.storage === "dropbox" && !row.folder.startsWith("/")) {
    return { ...empty, filingFailed: true, detail: "The destination folder is not a Dropbox path. The signature request was not sent again." };
  }
  if ((row.storage === "box" || row.storage === "google_drive" || row.storage === "onedrive") && !verifiedFolderId(row.storage, row.folder)) {
    return { ...empty, filingFailed: true, detail: `${row.storage === "box" ? "Box" : row.storage === "onedrive" ? "OneDrive" : "Google Drive"} needs a verified folder id. I did not file the document in another service.` };
  }
  const storageToken = await accessToken(row.advisor_id, row.storage);
  if (!storageToken) return { ...empty, filingFailed: true, detail: "The selected storage provider is not connected. The completed request was not filed and was not sent again." };
  const existing = [row.filed_signed, row.filed_audit].filter(Boolean);
  const signedName = existing.includes(`${row.document_id}-signed-${row.request_id}.pdf`)
    ? ""
    : `${row.document_id}-signed-${row.request_id}.pdf`;
  const auditName = `${row.document_id}-audit-${row.request_id}.zip`;
  let filedSigned = row.filed_signed;
  let filedAudit = row.filed_audit;
  let detail = "";
  if (!filedSigned && signedName) {
    const pdf = await fetch(filesUrl(row.request_id, "pdf"), { headers: { Authorization: `Bearer ${signToken}` } });
    const availability = filesAvailability(pdf.status);
    if (availability === "preparing") return { ...empty, detail: "Dropbox Sign is still preparing the completed files. Nothing was saved and the request was not sent again.", preparing: true };
    if (availability === "limited") return { ...empty, detail: "Dropbox Sign rate limit was reached while downloading. Nothing was saved.", limited: true, reset: pdf.headers.get("x-ratelimit-reset") };
    if (availability !== "ready") return { ...empty, filingFailed: true, detail: "The signed PDF was not available. The request was not sent again." };
    const saved = await storeSignedFile({ storage: row.storage, folder: row.folder, name: signedName, bytes: new Uint8Array(await pdf.arrayBuffer()), token: storageToken });
    if (!saved.ok) return { ...empty, filingFailed: true, detail: saved.error };
    filedSigned = row.storage === "dropbox" ? saved.path : saved.link || saved.path;
    detail = `Signed PDF saved as a new file at ${saved.path}.`;
  }
  if (!filedAudit) {
    const zip = await fetch(filesUrl(row.request_id, "zip"), { headers: { Authorization: `Bearer ${signToken}` } });
    const auditAvailability = filesAvailability(zip.status);
    if (auditAvailability === "ready") {
      const saved = await storeSignedFile({ storage: row.storage, folder: row.folder, name: auditName, bytes: new Uint8Array(await zip.arrayBuffer()), token: storageToken });
      if (saved.ok && saved.path) {
        filedAudit = row.storage === "dropbox" ? saved.path : saved.link || saved.path;
        detail = `${detail} Audit trail saved as a new file at ${saved.path}.`.trim();
      } else detail = `${detail} The audit trail was not saved.`.trim();
    } else if (auditAvailability === "limited" || auditAvailability === "preparing") {
      detail = `${detail} The audit trail is not ready. It will be checked again.`.trim();
    } else {
      filedAudit = "unavailable";
      detail = `${detail} No audit trail was available.`.trim();
    }
  }
  await (await getSql())`
    update signature_requests
    set filed_signed = ${filedSigned}, filed_audit = ${filedAudit}, status = 'completed', last_error = ''
    where advisor_id = ${row.advisor_id} and request_id = ${row.request_id}
  `;
  return {
    filedSigned: row.storage === "dropbox" ? filedSigned.startsWith("/") : filedSigned.startsWith("http"),
    filedAudit: row.storage === "dropbox" ? filedAudit.startsWith("/") : filedAudit.startsWith("http"),
    filingFailed: false,
    signedPath: filedSigned.startsWith("/") ? filedSigned : "",
    auditPath: filedAudit.startsWith("/") ? filedAudit : "",
    detail,
  };
}

async function rememberFiling(row: Row, filed: { filedSigned: boolean; filedAudit: boolean; filingFailed: boolean; signedPath: string; auditPath: string }) {
  await rememberSignatureOutcome(row.advisor_id, row.request_id, {
    documentId: row.document_id,
    folder: row.folder,
    completed: true,
    filedSigned: filed.filedSigned,
    filedAudit: filed.filedAudit,
    filingFailed: filed.filingFailed,
    signedPath: filed.signedPath,
    auditPath: filed.auditPath,
  });
}

async function checkRow(row: Row) {
  const provider = row.signature_provider || "dropbox_sign";
  if (provider !== "dropbox_sign") {
    const token = await accessToken(row.advisor_id, provider);
    if (!token) return { ok: false as const, error: "That signature provider is not connected for this advisor. I did not use Dropbox Sign." };
    const status = await readSignatureStatus({ provider, requestId: row.request_id, token });
    if (!status.ok) return status;
    await saveProgress(row, status.status, "", 200);
    if (status.status !== "completed") return { ok: true as const, requestId: row.request_id, status: status.status, detail: `Request ${row.request_id} is ${status.status.replaceAll("_", " ")}. Nothing was filed.` };
    const storageToken = await accessToken(row.advisor_id, row.storage);
    if (!storageToken) {
      const failed = { filedSigned: false, filedAudit: false, filingFailed: true, signedPath: "", auditPath: "", detail: "Signed successfully; saving failed. The selected storage provider is not connected." };
      await rememberFiling(row, failed);
      return { ok: true as const, requestId: row.request_id, status: status.status, ...failed };
    }
    const signedResponse = await fetch(status.documents.signed, { headers: { Authorization: `Bearer ${token}` } });
    if (!signedResponse.ok) {
      const failed = { filedSigned: false, filedAudit: false, filingFailed: true, signedPath: "", auditPath: "", detail: "Signed successfully; saving failed. The signed PDF was not available." };
      await rememberFiling(row, failed);
      return { ok: true as const, requestId: row.request_id, status: status.status, ...failed };
    }
    const signedName = `${row.document_id}-signed-${row.request_id}.pdf`;
    const signedSave = await storeSignedFile({ storage: row.storage, folder: row.folder, name: signedName, bytes: new Uint8Array(await signedResponse.arrayBuffer()), token: storageToken });
    const auditResponse = await fetch(status.documents.audit, { headers: { Authorization: `Bearer ${token}` } });
    const auditName = `${row.document_id}-audit-${row.request_id}.pdf`;
    const auditSave = auditResponse.ok ? await storeSignedFile({ storage: row.storage, folder: row.folder, name: auditName, bytes: new Uint8Array(await auditResponse.arrayBuffer()), token: storageToken }) : { ok: false as const, error: "" };
    const filed = {
      filedSigned: signedSave.ok,
      filedAudit: auditSave.ok,
      filingFailed: !signedSave.ok,
      signedPath: signedSave.ok ? signedSave.path : "",
      auditPath: auditSave.ok ? auditSave.path : "",
      detail: signedSave.ok ? `Signed PDF saved as a new file at ${signedSave.path}.` : "Signed successfully; saving failed.",
    };
    if (signedSave.ok) {
      await (await getSql())`
        update signature_requests
        set filed_signed = ${filed.signedPath}, filed_audit = ${filed.auditPath}, status = 'completed', last_error = ''
        where advisor_id = ${row.advisor_id} and request_id = ${row.request_id}
      `;
    }
    await rememberFiling(row, filed);
    return { ok: true as const, requestId: row.request_id, status: status.status, ...filed };
  }
  const token = await accessToken(row.advisor_id, "dropbox_sign");
  if (!token) return { ok: false as const, error: "Dropbox Sign is not connected for this advisor. I did not check a request." };
  const response = await fetch(statusUrl(row.request_id), { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 429) {
    const reset = Number(response.headers.get("x-ratelimit-reset") || "");
    await saveProgress(row, row.status as SignatureProgress, "rate limit", 429, Number.isFinite(reset) ? reset : undefined);
    return { ok: false as const, error: "Dropbox Sign rate limit was reached. The next check waits until the limit resets. The request was not sent again." };
  }
  const body = await response.json().catch(() => null);
  const record = body?.signature_request;
  if (!response.ok || !record) {
    await saveProgress(row, row.status as SignatureProgress, "status unavailable", response.status);
    return { ok: false as const, error: "Dropbox Sign did not return this request. I did not mark it completed." };
  }
  const status = statusFromProvider(record);
  await saveProgress(row, status, "", response.status);
  if (status !== "completed") return { ok: true as const, requestId: row.request_id, status, detail: `Request ${row.request_id} is ${status.replaceAll("_", " ")}. Nothing was filed.` };
  const filed = await fileCompleted({ ...row, status }, token);
  if (filed.filingFailed) {
    await (await getSql())`
      update signature_requests set last_error = ${filed.detail.slice(0, 240)}
      where advisor_id = ${row.advisor_id} and request_id = ${row.request_id}
    `;
  }
  await rememberFiling(row, filed);
  return { ok: true as const, requestId: row.request_id, status, ...filed };
}

export async function pollDueSignatures() {
  if (previewWritesBlocked() || externalSideEffectsBlocked()) return { checked: 0 };
  const rows = await pendingRows();
  if (!rows[0]) return { checked: 0 };
  await checkRow(rows[0]);
  return { checked: 1 };
}

export async function retrySignatureFiling(advisorId: number, requestId: string) {
  if (previewWritesBlocked() || externalSideEffectsBlocked()) return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK };
  await ensureSignatureRequests();
  const rows = await (await getSql())<Row>`
    select advisor_id, request_id, document_id, folder, storage, status, filed_signed, filed_audit, attempts, signature_provider
    from signature_requests where advisor_id = ${advisorId} and request_id = ${requestId} limit 1
  `;
  const row = rows[0];
  if (!row || row.advisor_id !== advisorId) return { ok: false as const, error: "That signature request is not on this advisor's desk. Nothing was sent." };
  if (row.status !== "completed") return { ok: false as const, error: "That document is not fully signed. Nothing was sent." };
  const token = await accessToken(advisorId, "dropbox_sign");
  if (!token) return { ok: false as const, error: "Dropbox Sign is not connected for this advisor. Nothing was sent." };
  const filed = await fileCompleted(row, token);
  await rememberFiling(row, filed);
  return { ok: true as const, detail: filed.filingFailed ? "Signed successfully; saving failed. The signature request was not sent again." : filed.detail, filingFailed: filed.filingFailed };
}

export async function checkAdvisorSignatures(advisorId: number) {
  if (previewWritesBlocked() || externalSideEffectsBlocked()) {
    return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK };
  }
  startSignatureWatch();
  await syncSignatureNotices(advisorId);
  const token = await accessToken(advisorId, "dropbox_sign");
  if (!token) return { ok: false as const, error: "Dropbox Sign is not connected for this advisor. I did not check a request." };
  const rows = await pendingRows(advisorId);
  if (!rows.length) return { ok: true as const, detail: "No signature request is waiting. Dropbox Sign was not asked for a status.", results: [] as const };
  const results: Array<Awaited<ReturnType<typeof checkRow>>> = [];
  for (const row of rows) {
    const result = await checkRow(row);
    results.push(result);
    if (!result.ok && result.error.includes("rate limit")) break;
  }
  return { ok: true as const, detail: results.map((item) => item.ok ? item.detail || `${item.requestId} is ${item.status}` : item.error).join(" "), results };
}
