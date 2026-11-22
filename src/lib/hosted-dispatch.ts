/**
 * Durable dispatch for birthday, drip, reply, and Dropbox Sign jobs.
 * Callers inject providers. This file does not open a network connection.
 */
import { executeBirthdayJob } from "./birthday-worker.ts";
import { runWindow, zonedParts, type BirthdayPerson } from "./birthday-job.ts";
import { sendDripStep } from "./desk-handlers.ts";
import { planReplyNotices, type ThreadMessage } from "./document-mail.ts";
import { budgetOpen } from "./hosted-runtime.ts";
import type { QuerySql } from "./library-store.ts";
import { OUTBOUND_BLOCKED } from "./outbound-guard.ts";

const LEASE_MS = 2 * 60 * 1000;

export type ProviderResult = "accepted" | "failed" | "unknown";

export type ReplyRead = ThreadMessage[] | { blocked: string } | { unknown: true };

export type DispatchProviders = {
  birthdayDeliver?: (
    person: BirthdayPerson,
    card: { text: string },
    context: { advisorId: number },
  ) => Promise<{ status: ProviderResult; providerId: string; detail?: string }>;
  dripSend?: (input: {
    advisorId: number;
    id: number;
    email: string;
    full_name: string;
    subject: string;
    body: string;
  }) => Promise<{ ok: boolean; unknown?: boolean; error?: string }>;
  listReplies?: (thread: { advisorId: number; conversationId: string; sentMessageId: string; sender: string }) => Promise<ReplyRead>;
  signatureStatus?: (row: { advisorId: number; requestId: string }) => Promise<{
    outcome: "waiting" | "completed" | "declined" | "blocked" | ProviderResult;
    providerId: string;
    detail?: string;
  }>;
  fileSigned?: (row: { advisorId: number; requestId: string; folder: string }) => Promise<{
    outcome: ProviderResult | "blocked";
    path?: string;
    detail?: string;
  }>;
};

type JobRow = { job_key: string; attempt: number; status: string; provider_id: string };

export async function ensureDispatchTables(sql: QuerySql) {
  await sql.query(`create table if not exists hosted_job_runs (
    run_key text primary key,
    kind text not null,
    slot text not null,
    status text not null,
    detail text not null default '',
    created_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists hosted_jobs (
    job_key text primary key,
    kind text not null,
    advisor_id integer not null default 0,
    status text not null,
    attempt integer not null default 0,
    lease_until timestamptz,
    not_before timestamptz,
    provider_id text not null default '',
    detail text not null default '',
    updated_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists drip_recipient_outcomes (
    campaign_id integer not null,
    email text not null,
    status text not null,
    primary key (campaign_id, email)
  )`);
  await sql.query(`create table if not exists document_mail_threads (
    advisor_id integer primary key,
    conversation_id text not null default '',
    sent_message_id text not null default '',
    sender text not null default '',
    recipient text not null default '',
    subject text not null default '',
    attachment_path text not null default ''
  )`);
  await sql.query(`create table if not exists document_mail_replies (
    advisor_id integer not null,
    message_id text not null,
    body text not null default '',
    created_at timestamptz not null default now(),
    primary key (advisor_id, message_id)
  )`);
  await sql.query(`create table if not exists signature_events (
    advisor_id text not null,
    request_id text not null,
    event_hash text not null,
    status text not null,
    primary key (advisor_id, request_id, event_hash)
  )`);
}

export async function reconcileClaims(sql: QuerySql, now: Date) {
  await sql.query(
    `update hosted_jobs
     set status = 'unknown', detail = 'worker stopped before a provider result was stored', lease_until = null, updated_at = now()
     where status = 'claimed' and lease_until is not null and lease_until < $1`,
    [now.toISOString()],
  );
  await sql.query(
    `update hosted_jobs j
     set status = 'failed', detail = 'restarted before the reply notice was stored', updated_at = now()
     where j.kind = 'reply' and j.status = 'unknown' and j.provider_id <> ''
       and not exists (
         select 1 from document_mail_replies r
         where r.advisor_id = j.advisor_id and r.message_id = j.provider_id
       )`,
  );
}

export async function claimJob(sql: QuerySql, input: { key: string; kind: string; advisorId: number; now: Date; providerId?: string }) {
  const until = new Date(input.now.getTime() + LEASE_MS).toISOString();
  const rows = await sql.query<JobRow>(
    `insert into hosted_jobs (job_key, kind, advisor_id, status, attempt, lease_until, provider_id)
     values ($1, $2, $3, 'claimed', 1, $4, $5)
     on conflict (job_key) do update
     set status = 'claimed',
         attempt = hosted_jobs.attempt + 1,
         lease_until = excluded.lease_until,
         provider_id = case when excluded.provider_id = '' then hosted_jobs.provider_id else excluded.provider_id end,
         updated_at = now()
     where hosted_jobs.status in ('pending', 'failed')
       and (hosted_jobs.not_before is null or hosted_jobs.not_before <= $6)
     returning job_key, attempt, status, provider_id`,
    [input.key, input.kind, input.advisorId, until, input.providerId || "", input.now.toISOString()],
  );
  return rows[0] || null;
}

export async function finishJob(sql: QuerySql, key: string, status: "accepted" | "failed" | "unknown" | "skipped" | "pending", detail: string, providerId = "") {
  await sql.query(
    `update hosted_jobs
     set status = $2, detail = $3, provider_id = case when $4 = '' then provider_id else $4 end, lease_until = null, updated_at = now()
     where job_key = $1 and status = 'claimed'`,
    [key, status, detail.slice(0, 500), providerId],
  );
}

async function reopenJob(sql: QuerySql, key: string, notBefore: Date, detail: string) {
  await sql.query(
    `update hosted_jobs
     set status = 'pending', not_before = $2, detail = $3, lease_until = null, updated_at = now()
     where job_key = $1 and status = 'claimed'`,
    [key, notBefore.toISOString(), detail.slice(0, 500)],
  );
}

function stopReason(kind: "mail" | "signature", outboundBlocked: boolean) {
  if (outboundBlocked) return OUTBOUND_BLOCKED;
  if (!budgetOpen(kind)) return "A budget switch is on. Nothing was sent.";
  return "";
}

async function dispatchBirthdays(sql: QuerySql, now: Date, stop: string, providers: DispatchProviders) {
  const deliver = stop
    ? async () => ({ status: "failed" as const, providerId: "" })
    : providers.birthdayDeliver;
  if (!deliver) return { providerCalls: 0, detail: "No birthday provider is configured. Nothing was sent." };
  const result = await executeBirthdayJob(sql, { now, deliver });
  return {
    providerCalls: stop ? 0 : result.providerCalls,
    detail: stop || result.notices.map((item) => item.body).join(" ").slice(0, 500),
  };
}

async function dispatchDrips(sql: QuerySql, now: Date, stop: string, providers: DispatchProviders) {
  const rows = await sql.query<Record<string, unknown>>(
    `select id, advisor_id, name, tag, steps, every_days, next_index, contact_ids, active, next_at
     from drip_campaigns where active = true and (next_at is null or next_at <= $1) order by id`,
    [now.toISOString()],
  );
  let attempted = 0;
  let advanced = 0;
  let calls = 0;
  for (const row of rows) {
    const id = Number(row.id);
    const index = Number(row.next_index) || 0;
    const advisorId = Number(row.advisor_id);
    const key = `drip:${id}:${index}`;
    const claimed = await claimJob(sql, { key, kind: "drip", advisorId, now });
    if (!claimed) continue;
    attempted += 1;
    if (stop || !providers.dripSend) {
      await finishJob(sql, key, "failed", stop || "No drip provider is configured. Nothing was sent.");
      continue;
    }
    const contacts = await sql.query<{ id: number; full_name: string; email: string; tags: string }>(
      "select id, full_name, email, tags from contacts where advisor_id = $1 order by id",
      [advisorId],
    );
    const saved = await sql.query<{ email: string; status: string }>(
      "select email, status from drip_recipient_outcomes where campaign_id = $1",
      [id],
    );
    const outcomes: Record<string, "sent" | "failed" | "unknown"> = {};
    for (const item of saved) {
      if (item.status === "sent" || item.status === "failed" || item.status === "unknown") outcomes[item.email.toLowerCase()] = item.status;
    }
    const send = providers.dripSend;
    let result: Awaited<ReturnType<typeof sendDripStep>>;
    try {
      result = await sendDripStep(
        { name: String(row.name || ""), steps: String(row.steps || "[]"), tag: String(row.tag || ""), contact_ids: String(row.contact_ids || "[]") },
        index,
        {
          isolated: false,
          contacts,
          outcomes,
          saveOutcome: async (email, status) => {
            await sql.query(
              `insert into drip_recipient_outcomes (campaign_id, email, status) values ($1, $2, $3)
               on conflict (campaign_id, email) do update set status = excluded.status`,
              [id, email.toLowerCase(), status],
            );
          },
          send: async (contact, step) => {
            calls += 1;
            return send({
              advisorId,
              id: Number(contact.id),
              email: contact.email,
              full_name: contact.full_name,
              subject: String(step?.title || row.name || "Note"),
              body: String(step?.body || ""),
            });
          },
        },
      );
    } catch {
      await finishJob(sql, key, "unknown", "provider ended before a result was stored");
      continue;
    }
    if (result.unknown.length) {
      await finishJob(sql, key, "unknown", "provider outcome unknown; this step was not advanced and was not sent again");
      continue;
    }
    if (!result.ok) {
      await finishJob(sql, key, "failed", result.error || "The drip step was not accepted.");
      continue;
    }
    const next = index + 1;
    let steps: unknown[] = [];
    try { steps = JSON.parse(String(row.steps || "[]")); } catch { steps = []; }
    const done = next >= steps.length;
    const nextAt = done ? null : new Date(now.getTime() + (Number(row.every_days) || 7) * 24 * 60 * 60 * 1000).toISOString();
    await sql.query(
      "update drip_campaigns set next_index = $2, active = $3, next_at = $4 where id = $1 and next_index = $5",
      [id, next, !done, nextAt, index],
    );
    await finishJob(sql, key, "accepted", done ? "last drip step accepted" : "drip step accepted", `drip-${id}-${index}`);
    advanced += 1;
  }
  return { attempted, advanced, calls };
}

async function dispatchReplies(sql: QuerySql, now: Date, stop: string, providers: DispatchProviders) {
  const threads = await sql.query<{ advisor_id: number; conversation_id: string; sent_message_id: string; sender: string }>(
    "select advisor_id, conversation_id, sent_message_id, sender from document_mail_threads order by advisor_id",
  );
  let stored = 0;
  let scans = 0;
  for (const thread of threads) {
    const advisorId = Number(thread.advisor_id);
    const scanKey = `reply-scan:${advisorId}:${thread.conversation_id}`;
    const scan = await claimJob(sql, { key: scanKey, kind: "reply-scan", advisorId, now });
    if (!scan) continue;
    scans += 1;
    if (stop || !providers.listReplies) {
      await finishJob(sql, scanKey, "failed", stop || "No mailbox reader is configured. Nothing was read.");
      continue;
    }
    let read: Awaited<ReturnType<NonNullable<DispatchProviders["listReplies"]>>>;
    try {
      read = await providers.listReplies({
        advisorId,
        conversationId: thread.conversation_id,
        sentMessageId: thread.sent_message_id,
        sender: thread.sender,
      });
    } catch {
      await finishJob(sql, scanKey, "unknown", "mailbox read ended before a result was stored");
      continue;
    }
    if (!Array.isArray(read)) {
      if ("unknown" in read && read.unknown) {
        await finishJob(sql, scanKey, "unknown", "mailbox read ended before a result was stored");
      } else {
        await finishJob(sql, scanKey, "failed", "blocked" in read ? read.blocked : "No mailbox reader is configured. Nothing was read.");
      }
      continue;
    }
    const messages = read;
    const seen = await sql.query<{ message_id: string }>(
      "select message_id from document_mail_replies where advisor_id = $1",
      [advisorId],
    );
    const planned = planReplyNotices({
      conversationId: thread.conversation_id,
      sentMessageId: thread.sent_message_id,
      sender: thread.sender,
      seen: seen.map((row) => row.message_id),
      messages,
    });
    for (const notice of planned) {
      const key = `reply:${advisorId}:${notice.messageId}`;
      const claimed = await claimJob(sql, { key, kind: "reply", advisorId, now, providerId: notice.messageId });
      if (!claimed) continue;
      const inserted = await sql.query<{ message_id: string }>(
        `insert into document_mail_replies (advisor_id, message_id, body)
         values ($1, $2, $3)
         on conflict (advisor_id, message_id) do nothing
         returning message_id`,
        [advisorId, notice.messageId, notice.body],
      );
      if (inserted.length) stored += 1;
      await finishJob(sql, key, "accepted", inserted.length ? "reply notice stored" : "duplicate reply ignored", notice.messageId);
    }
    await reopenJob(sql, scanKey, new Date(now.getTime() + 60_000), "reply scan finished");
  }
  return { scans, stored };
}

async function recordSignatureEvent(sql: QuerySql, advisorId: number, requestId: string, eventHash: string, status: string) {
  const inserted = await sql.query<{ event_hash: string }>(
    `insert into signature_events (advisor_id, request_id, event_hash, status)
     values ($1, $2, $3, $4)
     on conflict (advisor_id, request_id, event_hash) do nothing
     returning event_hash`,
    [String(advisorId), requestId, eventHash, status],
  );
  return inserted.length > 0;
}

async function dispatchSignatures(sql: QuerySql, now: Date, stop: string, providers: DispatchProviders) {
  const rows = await sql.query<Record<string, unknown>>(
    `select advisor_id, request_id, folder, storage, status, filed_signed, signature_provider
     from signature_requests
     where signature_provider = 'dropbox_sign' and storage = 'dropbox'
       and status not in ('declined', 'expired', 'failed')
     order by advisor_id, request_id`,
  );
  const others = await sql.query<{ n: number }>(
    `select count(*)::int as n from signature_requests
     where signature_provider <> 'dropbox_sign' or storage <> 'dropbox'`,
  );
  let checked = 0;
  let filed = 0;
  for (const row of rows) {
    const advisorId = Number(row.advisor_id);
    const requestId = String(row.request_id);
    const folder = String(row.folder || "");
    const alreadyFiled = String(row.filed_signed || "").startsWith("/");
    if (String(row.status) === "completed" && !alreadyFiled) {
      const key = `signature-file:${advisorId}:${requestId}`;
      const claimed = await claimJob(sql, { key, kind: "signature-file", advisorId, now, providerId: requestId });
      if (!claimed) continue;
      checked += 1;
      if (stop || !providers.fileSigned) {
        await finishJob(sql, key, "failed", stop || "No Dropbox filing provider is configured. Nothing was uploaded.");
        continue;
      }
      let saved: { outcome: ProviderResult | "blocked"; path?: string; detail?: string };
      try {
        saved = await providers.fileSigned({ advisorId, requestId, folder });
      } catch {
        saved = { outcome: "unknown" };
      }
      if (saved.outcome === "accepted" && saved.path?.startsWith("/")) {
        await sql.query(
          "update signature_requests set filed_signed = $3, last_error = '' where advisor_id = $1 and request_id = $2 and filed_signed = ''",
          [advisorId, requestId, saved.path],
        );
        await finishJob(sql, key, "accepted", "signed file stored in Dropbox", saved.path);
        filed += 1;
      } else if (saved.outcome === "unknown") {
        await finishJob(sql, key, "unknown", saved.detail || "Dropbox outcome unknown; the file was not uploaded again");
      } else if (saved.outcome === "blocked") {
        await finishJob(sql, key, "failed", saved.detail || "Dropbox filing is not authorized for this advisor. Nothing was uploaded.");
      } else {
        await finishJob(sql, key, "failed", saved.detail || "Dropbox did not accept the signed file");
      }
      continue;
    }
    if (String(row.status) === "completed") continue;
    const key = `signature-status:${advisorId}:${requestId}`;
    const claimed = await claimJob(sql, { key, kind: "signature-status", advisorId, now, providerId: requestId });
    if (!claimed) continue;
    checked += 1;
    if (stop || !providers.signatureStatus) {
      await finishJob(sql, key, "failed", stop || "No Dropbox Sign status provider is configured. Nothing was sent.");
      continue;
    }
    let status: Awaited<ReturnType<NonNullable<DispatchProviders["signatureStatus"]>>>;
    try {
      status = await providers.signatureStatus({ advisorId, requestId });
    } catch {
      await finishJob(sql, key, "unknown", "Dropbox Sign ended before a result was stored");
      continue;
    }
    const eventHash = `${requestId}:${status.providerId || status.outcome}`;
    const fresh = await recordSignatureEvent(sql, advisorId, requestId, eventHash, status.outcome);
    if (!fresh && status.outcome !== "completed") {
      await reopenJob(sql, key, new Date(now.getTime() + 15 * 60 * 1000), "duplicate callback ignored");
      continue;
    }
    if (status.outcome === "blocked") {
      await finishJob(sql, key, "failed", status.detail || "Dropbox Sign is not connected for this advisor. Nothing was sent.", status.providerId);
      continue;
    }
    if (status.outcome === "unknown") {
      await finishJob(sql, key, "unknown", "Dropbox Sign outcome unknown; the request was not sent again", status.providerId);
      continue;
    }
    if (status.outcome === "completed") {
      await sql.query(
        "update signature_requests set status = 'completed' where advisor_id = $1 and request_id = $2",
        [advisorId, requestId],
      );
      await finishJob(sql, key, "accepted", "signature completed; filing is a separate job", status.providerId);
      continue;
    }
    if (status.outcome === "declined" || status.outcome === "failed") {
      await sql.query(
        "update signature_requests set status = $3 where advisor_id = $1 and request_id = $2",
        [advisorId, requestId, status.outcome === "declined" ? "declined" : "failed"],
      );
      await finishJob(sql, key, "accepted", `signature ${status.outcome}; nothing else was sent`, status.providerId);
      continue;
    }
    await reopenJob(sql, key, new Date(now.getTime() + 15 * 60 * 1000), "signature still waiting");
  }
  return { checked, filed, skippedOtherProviders: Number(others[0]?.n || 0) };
}

export async function runHostedDispatch(sql: QuerySql, input: { now: Date; outboundBlocked: boolean; providers?: DispatchProviders }) {
  await ensureDispatchTables(sql);
  await reconcileClaims(sql, input.now);
  const providers = input.providers || {};
  const mailStop = stopReason("mail", input.outboundBlocked);
  const signStop = stopReason("signature", input.outboundBlocked);
  const birthdays = await dispatchBirthdays(sql, input.now, mailStop, providers);
  const drips = await dispatchDrips(sql, input.now, mailStop, providers);
  const replies = await dispatchReplies(sql, input.now, mailStop, providers);
  const signatures = await dispatchSignatures(sql, input.now, signStop, providers);
  const sent = drips.advanced + replies.stored + signatures.filed;
  return { birthdays, drips, replies, signatures, sent, blocked: input.outboundBlocked };
}

export function birthdayDue(now: Date, timeZone: string, lastRunDate: string, authorized: boolean) {
  if (!authorized) return false;
  const local = zonedParts(now, timeZone || "America/Toronto");
  return runWindow(local, lastRunDate) === "run";
}
