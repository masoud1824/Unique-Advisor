import { getSql } from "@/lib/db";
import { dropboxWebLink, planSignatureNotices, type PlannedNotice, type SignatureNoticeKind } from "@/lib/signature-notices";

export type SignatureNotice = {
  id: number;
  requestId: string;
  kind: SignatureNoticeKind;
  body: string;
  folder: string;
  signedPath: string;
  auditPath: string;
  signedUrl: string;
  auditUrl: string;
  unread: boolean;
  at: string;
};

async function ensureSignatureNotices() {
  const sql = await getSql();
  await sql.query(`create table if not exists signature_notices (
    id serial primary key,
    advisor_id integer not null,
    request_id text not null,
    kind text not null,
    body text not null,
    folder text not null default '',
    signed_path text not null default '',
    audit_path text not null default '',
    unread boolean not null default true,
    created_at timestamptz not null default now(),
    unique (advisor_id, request_id, kind)
  )`);
}

async function existingKinds(advisorId: number, requestId: string) {
  await ensureSignatureNotices();
  const rows = await (await getSql())<{ kind: string }>`
    select kind from signature_notices where advisor_id = ${advisorId} and request_id = ${requestId}
  `;
  return rows.map((row) => row.kind);
}

export async function storeSignatureNotices(advisorId: number, requestId: string, planned: PlannedNotice[]) {
  if (!advisorId || !requestId || !planned.length) return { stored: 0 };
  await ensureSignatureNotices();
  const sql = await getSql();
  const owned = await sql<{ advisor_id: number }>`
    select advisor_id from signature_requests where advisor_id = ${advisorId} and request_id = ${requestId} limit 1
  `;
  if (!owned[0] || Number(owned[0].advisor_id) !== advisorId) return { stored: 0 };
  let stored = 0;
  for (const notice of planned) {
    const rows = await sql<{ id: number }>`
      insert into signature_notices (advisor_id, request_id, kind, body, folder, signed_path, audit_path)
      values (${advisorId}, ${requestId}, ${notice.kind}, ${notice.body.slice(0, 700)}, ${notice.folder}, ${notice.signedPath}, ${notice.auditPath})
      on conflict (advisor_id, request_id, kind) do nothing
      returning id
    `;
    if (rows[0]) stored += 1;
  }
  return { stored };
}

export async function syncSignatureNotices(advisorId: number) {
  await ensureSignatureNotices();
  const sql = await getSql();
  const rows = await sql<{
    request_id: string;
    document_id: string;
    folder: string;
    status: string;
    filed_signed: string;
    filed_audit: string;
    last_error: string;
  }>`
    select request_id, document_id, folder, status, filed_signed, filed_audit, last_error
    from signature_requests where advisor_id = ${advisorId}
  `;
  for (const row of rows) {
    const kinds = await existingKinds(advisorId, row.request_id);
    const filedSigned = String(row.filed_signed || "").startsWith("/");
    const filedAudit = String(row.filed_audit || "").startsWith("/");
    const planned = planSignatureNotices({
      documentId: row.document_id,
      folder: row.folder,
      completed: row.status === "completed",
      filedSigned,
      filedAudit,
      filingFailed: row.status === "completed" && !filedSigned && Boolean(row.last_error),
      existingKinds: kinds,
      signedPath: row.filed_signed,
      auditPath: filedAudit ? row.filed_audit : "",
      backfill: true,
    });
    await storeSignatureNotices(advisorId, row.request_id, planned);
  }
}

export async function listSignatureNotices(advisorId: number): Promise<SignatureNotice[]> {
  await syncSignatureNotices(advisorId);
  const rows = await (await getSql())<{
    id: number;
    request_id: string;
    kind: SignatureNoticeKind;
    body: string;
    folder: string;
    signed_path: string;
    audit_path: string;
    unread: boolean;
    created_at: string;
  }>`
    select id, request_id, kind, body, folder, signed_path, audit_path, unread, created_at
    from signature_notices where advisor_id = ${advisorId}
    order by id desc
    limit 30
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    requestId: row.request_id,
    kind: row.kind,
    body: row.body,
    folder: row.folder,
    signedPath: row.signed_path,
    auditPath: row.audit_path,
    signedUrl: row.signed_path.startsWith("http") ? row.signed_path : dropboxWebLink(row.signed_path),
    auditUrl: row.audit_path.startsWith("http") ? row.audit_path : dropboxWebLink(row.audit_path),
    unread: Boolean(row.unread),
    at: new Date(row.created_at).toISOString(),
  }));
}

export async function markSignatureNoticesRead(advisorId: number) {
  await ensureSignatureNotices();
  await (await getSql())`update signature_notices set unread = false where advisor_id = ${advisorId} and unread = true`;
}

export async function rememberSignatureOutcome(advisorId: number, requestId: string, input: {
  documentId: string;
  folder: string;
  completed: boolean;
  filedSigned: boolean;
  filedAudit: boolean;
  filingFailed: boolean;
  signedPath?: string;
  auditPath?: string;
}) {
  const planned = planSignatureNotices({ ...input, existingKinds: await existingKinds(advisorId, requestId) });
  return storeSignatureNotices(advisorId, requestId, planned);
}
