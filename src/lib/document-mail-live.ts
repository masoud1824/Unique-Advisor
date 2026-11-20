import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { accessToken } from "@/lib/advisor-links";
import { accessTokenForAdvisor, graphMe } from "@/lib/microsoft-mail";
import { chooseDropboxDocument, WORKFLOW_DOCUMENT } from "@/lib/signature-workflow-document";
import { reviewedTestDecision, DOCUMENT_MAIL, REVIEWED_ATTACHMENT, noticesToCreate } from "@/lib/document-mail";
import { listWorkflowFolder, readSelectedWorkflow } from "@/lib/signature-workflow-live";
import { previewWritesBlocked } from "@/lib/preview-readonly";
import { externalSideEffectsBlocked, ISOLATED_EXTERNAL_BLOCK } from "@/lib/isolated-test-desk";
import { ingestDocumentReplies } from "@/lib/workflow-entry";
import { checkDocumentReplies as reviewStoredReplies } from "@/lib/desk-handlers";

const watch = globalThis as {
  __uaMailTimer?: ReturnType<typeof setInterval>;
  __uaMailCheck?: (advisorId: number) => Promise<unknown>;
};

export async function ensureDocumentMail() {
  const sql = await getSql();
  await sql.query(`create table if not exists document_mail_threads (
    advisor_id integer primary key,
    conversation_id text not null,
    sent_message_id text not null,
    sender text not null,
    recipient text not null,
    subject text not null,
    attachment_path text not null
  )`);
  await sql.query(`create table if not exists document_mail_replies (
    advisor_id integer not null,
    message_id text not null,
    body text not null,
    created_at timestamptz not null default now(),
    primary key (advisor_id, message_id)
  )`);
}

export async function selectedMailAttachment(advisorId: number) {
  const token = await accessToken(advisorId, "dropbox");
  if (!token) return { ok: false as const, error: "Dropbox is not connected for this advisor. Nothing was sent." };
  const listed = await listWorkflowFolder(token);
  if (!listed.ok) return listed;
  const choice = chooseDropboxDocument(listed.files, WORKFLOW_DOCUMENT.title);
  if (!choice.ok) return choice;
  const file = listed.files.find((item) => item.path === choice.file.path);
  if (!file?.hash) return { ok: false as const, error: "Dropbox did not return the attachment hash. Nothing was sent." };
  return { ok: true as const, path: file.path, name: file.name, size: file.size, hash: file.hash };
}

export async function assessReviewedTestMail(advisor: { id: number; slug: string }, approvalText: string) {
  await ensureDocumentMail();
  const existing = await (await getSql())<{ advisor_id: number }>`
    select advisor_id from document_mail_threads where advisor_id = ${advisor.id} limit 1
  `;
  const attachment = await selectedMailAttachment(advisor.id);
  if (!attachment.ok) return { ...attachment, sent: false as const };
  let sender = "";
  try {
    sender = (await graphMe(await accessTokenForAdvisor(advisor.id))).email;
  } catch {
    sender = "";
  }
  const decision = reviewedTestDecision({
    advisorSlug: advisor.slug,
    sender,
    to: [DOCUMENT_MAIL.recipient],
    cc: [],
    bcc: [],
    attachment,
    approvalText,
    alreadySent: Boolean(existing[0]),
  });
  return { ...decision, sent: false as const };
}

function dropboxContentHash(bytes: Uint8Array) {
  const block = 4 * 1024 * 1024;
  const parts: Buffer[] = [];
  for (let offset = 0; offset < Math.max(bytes.length, 1); offset += block) {
    if (bytes.length === 0) break;
    parts.push(createHash("sha256").update(bytes.subarray(offset, Math.min(offset + block, bytes.length))).digest());
  }
  return createHash("sha256").update(Buffer.concat(parts)).digest("hex");
}

export async function sendReviewedTestMail(advisor: { id: number; slug: string }, approvalText: string) {
  if (previewWritesBlocked() || externalSideEffectsBlocked()) {
    return { ok: false as const, sent: false as const, error: ISOLATED_EXTERNAL_BLOCK };
  }
  const assessed = await assessReviewedTestMail(advisor, approvalText);
  if (!assessed.ok) return { ok: false as const, sent: false as const, error: "error" in assessed ? assessed.error : "Nothing was sent." };
  const dropboxToken = await accessToken(advisor.id, "dropbox");
  if (!dropboxToken) return { ok: false as const, sent: false as const, error: "Dropbox is not connected for this advisor. Nothing was sent." };
  const file = await readSelectedWorkflow(dropboxToken);
  if (!file.ok) return { ok: false as const, sent: false as const, error: file.error };
  const hash = dropboxContentHash(file.bytes);
  if (
    file.path !== REVIEWED_ATTACHMENT.path
    || file.name !== REVIEWED_ATTACHMENT.name
    || file.bytes.byteLength !== REVIEWED_ATTACHMENT.size
    || hash !== REVIEWED_ATTACHMENT.hash
  ) {
    return { ok: false as const, sent: false as const, error: "The downloaded file is not the reviewed version. Nothing was sent." };
  }
  const token = await accessTokenForAdvisor(advisor.id);
  const sender = (await graphMe(token)).email;
  if (!assessed.preview.startsWith(`From: ${sender}`)) {
    return { ok: false as const, sent: false as const, error: "The connected sender does not match the approved preview. Nothing was sent." };
  }
  const sql = await getSql();
  const existing = await sql<{ conversation_id: string }>`select conversation_id from document_mail_threads where advisor_id = ${advisor.id} limit 1`;
  if (existing[0]) return { ok: false as const, sent: false as const, error: "This email was already sent. It was not sent again." };
  await sql`
    insert into document_mail_threads (advisor_id, conversation_id, sent_message_id, sender, recipient, subject, attachment_path)
    values (${advisor.id}, 'pending', 'pending', ${sender}, ${DOCUMENT_MAIL.recipient}, ${DOCUMENT_MAIL.subject}, ${REVIEWED_ATTACHMENT.path})
  `;
  const started = new Date(Date.now() - 15_000).toISOString();
  const sent = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      saveToSentItems: true,
      message: {
        subject: DOCUMENT_MAIL.subject,
        body: { contentType: "Text", content: DOCUMENT_MAIL.body },
        toRecipients: [{ emailAddress: { address: DOCUMENT_MAIL.recipient } }],
        attachments: [{
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: REVIEWED_ATTACHMENT.name,
          contentType: "application/pdf",
          contentBytes: Buffer.from(file.bytes).toString("base64"),
        }],
      },
    }),
  });
  if (sent.status !== 202 && sent.status !== 200) {
    const detail = (await sent.text()).slice(0, 240);
    await sql`delete from document_mail_threads where advisor_id = ${advisor.id} and conversation_id = 'pending'`;
    return { ok: false as const, sent: false as const, error: `Microsoft did not send the message. Nothing was sent. ${detail}` };
  }
  let sentId = "";
  let conversationId = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const found = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$orderby=sentDateTime desc&$top=8&$select=id,conversationId,subject,sentDateTime,hasAttachments,toRecipients", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!found.ok) continue;
    const body = await found.json() as { value?: Array<{ id?: string; conversationId?: string; subject?: string; sentDateTime?: string; hasAttachments?: boolean; toRecipients?: Array<{ emailAddress?: { address?: string } }> }> };
    const match = (body.value || []).find((item) => {
      const tos = (item.toRecipients || []).map((recipient) => (recipient.emailAddress?.address || "").trim().toLowerCase());
      return item.subject === DOCUMENT_MAIL.subject
        && item.hasAttachments === true
        && tos.length === 1
        && tos[0] === DOCUMENT_MAIL.recipient
        && String(item.sentDateTime || "") >= started;
    });
    if (!match?.id || !match.conversationId) continue;
    sentId = match.id;
    conversationId = match.conversationId;
    break;
  }
  if (!sentId || !conversationId) {
    return { ok: false as const, sent: true as const, error: "Microsoft accepted one send, but the sent thread could not be confirmed yet. I did not send another copy." };
  }
  await sql`
    update document_mail_threads
    set conversation_id = ${conversationId}, sent_message_id = ${sentId}, sender = ${sender}
    where advisor_id = ${advisor.id}
  `;
  await sql.query(`create table if not exists desk_notices (
    id serial primary key,
    advisor_id integer not null,
    body text not null,
    seen boolean not null default false,
    created_at timestamptz not null default now()
  )`);
  await sql`insert into desk_notices (advisor_id, body) values (${advisor.id}, ${`The Signature Workflow Test email was sent once to ${DOCUMENT_MAIL.recipient}. Replies to that email are being tracked.`})`;
  startDocumentMailWatch();
  return { ok: true as const, sent: true as const, sender, recipient: DOCUMENT_MAIL.recipient, conversationId, subject: DOCUMENT_MAIL.subject };
}

export async function saveReplyNotices(advisorId: number, planned: { messageId: string; body: string }[]) {
  await ensureDocumentMail();
  const sql = await getSql();
  const seenRows = await sql<{ message_id: string }>`select message_id from document_mail_replies where advisor_id = ${advisorId}`;
  const created = noticesToCreate(planned, seenRows.map((row) => row.message_id));
  await sql.query(`create table if not exists desk_notices (
    id serial primary key,
    advisor_id integer not null,
    body text not null,
    seen boolean not null default false,
    created_at timestamptz not null default now()
  )`);
  let stored = 0;
  for (const notice of created) {
    const already = await sql<{ message_id: string }>`
      select message_id from document_mail_replies where advisor_id = ${advisorId} and message_id = ${notice.messageId} limit 1
    `;
    if (already[0]) continue;
    await sql`
      insert into document_mail_replies (advisor_id, message_id, body)
      values (${advisorId}, ${notice.messageId}, ${notice.body})
      on conflict (advisor_id, message_id) do nothing
    `;
    const saved = await sql<{ message_id: string }>`
      select message_id from document_mail_replies where advisor_id = ${advisorId} and message_id = ${notice.messageId} limit 1
    `;
    if (!saved[0]) continue;
    stored += 1;
    await sql`insert into desk_notices (advisor_id, body) values (${advisorId}, ${notice.body})`;
  }
  return stored;
}

export async function checkDocumentReplies(advisorId: number, io?: Parameters<typeof reviewStoredReplies>[0]) {
  if (io) return reviewStoredReplies(io);
  if (previewWritesBlocked() || externalSideEffectsBlocked()) {
    return { ok: false as const, checked: 0, stored: 0, error: ISOLATED_EXTERNAL_BLOCK, providerCalled: false as const };
  }
  await ensureDocumentMail();
  const sql = await getSql();
  const rows = await sql<{ conversation_id: string; sent_message_id: string; sender: string }>`
    select conversation_id, sent_message_id, sender from document_mail_threads where advisor_id = ${advisorId} limit 1
  `;
  const thread = rows[0];
  if (!thread) return { ok: true as const, checked: 0, stored: 0, detail: "No document email has been sent, so no mailbox thread was read." };
  let token = "";
  try {
    token = await accessTokenForAdvisor(advisorId);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "This advisor's mailbox is not connected." };
  }
  const filter = `conversationId eq '${thread.conversation_id.replace(/'/g, "''")}'`;
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$select=id,conversationId,from`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { ok: false as const, error: "The sent thread could not be read. No other mail was opened." };
  const body = await response.json() as { value?: Array<{ id?: string; conversationId?: string; from?: { emailAddress?: { address?: string } } }> };
  const seenRows = await sql<{ message_id: string }>`select message_id from document_mail_replies where advisor_id = ${advisorId}`;
  const ingested = await reviewStoredReplies({
    isolated: false,
    conversationId: thread.conversation_id,
    sentMessageId: thread.sent_message_id,
    sender: thread.sender,
    seenIds: seenRows.map((row) => row.message_id),
    messages: (body.value || []).map((item) => ({
      id: String(item.id || ""),
      conversationId: String(item.conversationId || ""),
      from: String(item.from?.emailAddress?.address || ""),
    })),
    remember: async (notice) => {
      const stored = await saveReplyNotices(advisorId, [notice]);
      return stored > 0;
    },
  });
  return { ok: true as const, checked: 1, stored: ingested.stored, detail: ingested.stored ? `${ingested.stored} new reply notice${ingested.stored === 1 ? "" : "s"} saved.` : "No new reply in this thread." };
}

export function startDocumentMailWatch() {
  if (previewWritesBlocked() || externalSideEffectsBlocked()) return;
  watch.__uaMailCheck = checkDocumentReplies;
  if (watch.__uaMailTimer) return;
  watch.__uaMailTimer = setInterval(() => {
    const check = watch.__uaMailCheck;
    if (!check) return;
    void (async () => {
      await ensureDocumentMail();
      const rows = await (await getSql())<{ advisor_id: number }>`select advisor_id from document_mail_threads limit 1`;
      if (!rows[0]) return;
      await check(Number(rows[0].advisor_id));
    })().catch(() => undefined);
  }, 60_000);
}
