import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ensureDispatchTables } from "./hosted-dispatch.ts";
import { buildHostedProviders, productionAdvisorSecrets, type AdvisorSecrets } from "./hosted-providers.ts";
import { handleJobTick } from "./hosted-tick.ts";
import type { QuerySql } from "./library-store.ts";

const dir = `/opt/ua-release/data/hosted-provider-test-${process.pid}`;
const cron = "Bearer test-cron-secret-16";
let pg: PGlite;
let sql: QuerySql;
const seen: Array<{ url: string; authorization: string; body: string }> = [];
let mailStatus = 202;

function wrap(database: PGlite): QuerySql {
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const result = await database.query<T>(text, params);
      return result.rows as T[];
    },
  };
}

const secrets: AdvisorSecrets = {
  async microsoftAccess(advisorId) {
    return advisorId === 1
      ? { ok: true, token: "mail-advisor-1" }
      : { ok: false, blocked: "Microsoft mailbox is not connected for this advisor. Nothing was sent." };
  },
  async dropboxAccess(advisorId) {
    return advisorId === 1
      ? { ok: true, token: "dropbox-advisor-1" }
      : { ok: false, blocked: "Dropbox is not connected for this advisor. Nothing was uploaded." };
  },
  async dropboxSignAccess(advisorId) {
    return advisorId === 1
      ? { ok: true, token: "sign-advisor-1" }
      : { ok: false, blocked: "Dropbox Sign is not connected for this advisor. Nothing was sent." };
  },
};

const fetchImpl: typeof fetch = async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  seen.push({ url, authorization: headers.get("authorization") || "", body: typeof init?.body === "string" ? init.body : "" });
  if (url.includes("/me/sendMail")) return new Response("", { status: mailStatus });
  if (url.includes("graph.microsoft.com") && url.includes("messages")) {
    return Response.json({ value: [{ id: "reply-1", conversationId: "thread-1", from: { emailAddress: { address: "casey.sample@example.invalid" } } }] });
  }
  if (url.includes("/signature_request/files/")) return new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200 });
  if (url.includes("/signature_request/")) {
    return Response.json({ signature_request: { signature_request_id: "req-1", is_complete: false, signatures: [{ status_code: "awaiting_signature" }] } });
  }
  if (url.includes("content.dropboxapi.com")) return Response.json({ path_display: "/Unique Advisor/Signed/req-file-signed.pdf" });
  throw new Error(`unexpected provider url ${url}`);
};

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const openEnv: Record<string, string | undefined> = {
  UA_HOST_ENV: "production",
  UA_JOBS_EXECUTE: "1",
  UA_OUTBOUND_BLOCK: undefined,
  UA_RELEASE_ENV: undefined,
  UA_BUDGET_HALT: undefined,
  UA_BUDGET_HALT_MAIL: undefined,
  UA_BUDGET_HALT_SIGNATURE: undefined,
  UA_ISOLATED_TEST: undefined,
  UA_BIRTHDAY_LIVE: undefined,
  CRON_SECRET: "test-cron-secret-16",
};

async function reset() {
  seen.length = 0;
  mailStatus = 202;
  await sql.query("delete from hosted_jobs");
  await sql.query("delete from hosted_job_runs");
  await sql.query("delete from drip_recipient_outcomes");
  await sql.query("delete from document_mail_replies");
  await sql.query("delete from document_mail_threads");
  await sql.query("delete from signature_events");
  await sql.query("delete from signature_requests");
  await sql.query("delete from birthday_notices");
  await sql.query("delete from birthday_claims");
  await sql.query("delete from drip_campaigns");
  await sql.query("update contacts set birthday = '1990-11-20'");
  await sql.query("update birthday_settings set enabled = true, source = 'desk', confirmed_version = 1, template_version = 1, last_run_date = '', timezone = 'America/Toronto'");
}

async function tick(now: string) {
  const response = await handleJobTick(new Request("https://staging.example/api/jobs/tick", { headers: { authorization: cron } }), {
    now: new Date(now),
    sql,
    fetchImpl,
    secrets,
  });
  return response.json() as Promise<{ ok: boolean; blocked: boolean; execute: boolean; sent: number; detail: string; birthdays: number; replies: number; signaturesFiled: number }>;
}

describe("hosted provider adapters", () => {
  before(async () => {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    pg = new PGlite(dir);
    await pg.waitReady;
    sql = wrap(pg);
    await pg.exec(`
      create table advisors (id serial primary key, slug text not null, status text not null default 'active');
      create table contacts (
        id serial primary key, advisor_id integer not null, full_name text not null,
        email text not null default '', tags text not null default '', birthday text not null default ''
      );
      create table birthday_settings (
        advisor_id integer primary key, enabled boolean not null default false, source text not null default '',
        timezone text not null default 'America/Toronto', feb29 text not null default 'skip',
        card_title text not null default '', template_version integer not null default 1,
        confirmed_version integer not null default 0, last_run_date text not null default '',
        source_ref text not null default '', updated_at timestamptz not null default now()
      );
      create table birthday_claims (
        claim_key text primary key, advisor_id integer not null, contact_id text not null,
        occasion_year text not null, status text not null, provider_id text not null default '',
        detail text not null default '', updated_at timestamptz not null default now()
      );
      create table birthday_notices (
        id serial primary key, advisor_id integer not null, run_date text not null,
        body text not null, created_at timestamptz not null default now()
      );
      create table drip_campaigns (
        id serial primary key, advisor_id integer not null, name text not null, tag text not null default '',
        steps text not null default '[]', every_days integer not null default 7, active boolean not null default false,
        next_index integer not null default 0, next_at timestamptz, contact_ids text not null default '[]'
      );
      create table signature_requests (
        advisor_id integer not null, request_id text not null, folder text not null default '',
        storage text not null default 'dropbox', status text not null default 'sent',
        filed_signed text not null default '', signature_provider text not null default 'dropbox_sign',
        last_error text not null default '',
        primary key (advisor_id, request_id)
      );
    `);
    await sql.query("insert into advisors (slug) values ('staging-practice'), ('other-practice')");
    await sql.query("insert into contacts (advisor_id, full_name, email, tags, birthday) values (1, 'Casey Sample', 'casey.sample@example.invalid', '', '1990-11-20'), (2, 'Other Sample', 'other.sample@example.invalid', '', '1990-11-20')");
    await sql.query(`insert into birthday_settings (advisor_id, enabled, source, timezone, card_title, template_version, confirmed_version)
      values (1, true, 'desk', 'America/Toronto', 'Happy birthday, {{name}}.', 1, 1),
             (2, true, 'desk', 'America/Toronto', 'Happy birthday, {{name}}.', 1, 1)`);
    await ensureDispatchTables(sql);
  });

  after(async () => {
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps the HTTP entry on the tick route", () => {
    const source = readFileSync(new URL("../routes/api/jobs/tick.ts", import.meta.url), "utf8");
    assert.match(source, /handleJobTick\(request\)/);
    assert.doesNotMatch(source, /Nothing was sent\./);
  });

  it("does not call a provider when the execution flag is set on staging", async () => {
    await reset();
    await withEnv({ ...openEnv, UA_HOST_ENV: "staging", UA_RELEASE_ENV: "staging", UA_OUTBOUND_BLOCK: "1", UA_JOBS_EXECUTE: "1" }, async () => {
      const body = await tick("2026-11-20T14:00:00.000Z");
      assert.equal(body.ok, true);
      assert.equal(body.blocked, true);
      assert.equal(body.execute, false);
      assert.equal(body.sent, 0);
      assert.match(body.detail, /Nothing was sent/);
      assert.deepEqual(seen, []);
    });
  });

  it("does not let the execution flag bypass the host guard", async () => {
    await reset();
    await withEnv({ ...openEnv, UA_HOST_ENV: undefined, UA_JOBS_EXECUTE: "1" }, async () => {
      const body = await tick("2026-11-20T14:00:00.000Z");
      assert.equal(body.execute, false);
      assert.match(body.detail, /execution flag alone does not send/);
      assert.deepEqual(seen, []);
    });
  });

  it("reports a missing mailbox as blocked and does not use another advisor's token", async () => {
    await reset();
    await withEnv(openEnv, async () => {
      const body = await tick("2026-11-20T14:00:00.000Z");
      assert.equal(body.execute, true);
      assert.equal(body.blocked, false);
      assert.equal(seen.filter((call) => call.url.includes("/me/sendMail")).length, 1);
      assert.equal(seen[0]?.authorization, "Bearer mail-advisor-1");
      assert.match(seen[0]?.body || "", /casey\.sample@example\.invalid/);
      assert.doesNotMatch(seen.map((call) => call.body).join("\n"), /other\.sample@example\.invalid/);
      assert.equal(seen.some((call) => call.authorization.includes("advisor-2")), false);
      const claims = await sql.query<{ advisor_id: number; status: string; detail: string }>("select advisor_id, status, detail from birthday_claims order by advisor_id");
      assert.equal(claims.find((row) => Number(row.advisor_id) === 1)?.status, "accepted");
      assert.equal(claims.find((row) => Number(row.advisor_id) === 2)?.status, "failed");
      assert.match(String(claims.find((row) => Number(row.advisor_id) === 2)?.detail), /not connected/);
      const again = await tick("2026-11-20T14:05:00.000Z");
      assert.equal(again.birthdays, 1);
      assert.equal(seen.filter((call) => call.url.includes("/me/sendMail")).length, 1);
      const still = await sql.query<{ status: string }>("select status from birthday_claims where advisor_id = 1");
      assert.equal(still[0]?.status, "accepted");
    });
  });

  it("follows Toronto standard time and daylight time, and skips a cancelled or changed approval", async () => {
    await reset();
    await sql.query("update birthday_settings set enabled = false where advisor_id = 2");
    await sql.query("update contacts set birthday = '1990-01-20' where advisor_id = 1");
    await withEnv(openEnv, async () => {
      const winter = await tick("2026-01-20T14:00:00.000Z");
      assert.equal(winter.birthdays, 1);
      await sql.query("delete from birthday_claims");
      await sql.query("update birthday_settings set last_run_date = '' where advisor_id = 1");
      await sql.query("update contacts set birthday = '1990-07-20' where advisor_id = 1");
      seen.length = 0;
      const summerMiss = await tick("2026-07-20T14:00:00.000Z");
      assert.equal(summerMiss.birthdays, 0);
      assert.equal(seen.filter((call) => call.url.includes("/me/sendMail")).length, 0);
      const summer = await tick("2026-07-20T13:00:00.000Z");
      assert.equal(summer.birthdays, 1);
      await sql.query("delete from birthday_claims");
      await sql.query("update contacts set birthday = '1990-11-20' where advisor_id = 1");
      await sql.query("update birthday_settings set last_run_date = '', enabled = false where advisor_id = 1");
      await sql.query("update birthday_settings set last_run_date = '', enabled = true, confirmed_version = 0 where advisor_id = 2");
      seen.length = 0;
      const cancelled = await tick("2026-11-20T14:00:00.000Z");
      assert.equal(cancelled.birthdays, 0);
      assert.deepEqual(seen, []);
    });
  });

  it("reads only that advisor's thread, stores one reply, and does not read again while the scan is closed", async () => {
    await reset();
    await sql.query("update birthday_settings set enabled = false");
    await sql.query(`insert into document_mail_threads (advisor_id, conversation_id, sent_message_id, sender)
      values (1, 'thread-1', 'sent-1', 'desk@example.invalid'), (2, 'thread-2', 'sent-2', 'other@example.invalid')`);
    await withEnv(openEnv, async () => {
      const first = await tick("2026-11-21T15:00:00.000Z");
      assert.equal(first.replies, 1);
      const graph = seen.filter((call) => call.url.includes("graph.microsoft.com") && call.url.includes("messages"));
      assert.equal(graph.length, 1);
      assert.match(graph[0]?.url || "", /thread-1/);
      assert.equal(graph[0]?.authorization, "Bearer mail-advisor-1");
      const second = await tick("2026-11-21T15:00:30.000Z");
      assert.equal(second.replies, 0);
      assert.equal(seen.filter((call) => call.url.includes("messages")).length, 1);
      const rows = await sql.query("select message_id from document_mail_replies");
      assert.equal(rows.length, 1);
      const blocked = await sql.query<{ status: string; detail: string }>("select status, detail from hosted_jobs where job_key like 'reply-scan:2:%'");
      assert.equal(blocked[0]?.status, "failed");
      assert.match(blocked[0]?.detail || "", /not connected/);
    });
  });

  it("does not retry a birthday after Microsoft's result is unknown", async () => {
    await reset();
    await sql.query("update birthday_settings set enabled = false where advisor_id = 2");
    mailStatus = 500;
    await withEnv(openEnv, async () => {
      await tick("2026-11-20T14:00:00.000Z");
      const claim = await sql.query<{ status: string }>("select status from birthday_claims where advisor_id = 1");
      assert.equal(claim[0]?.status, "unknown");
      seen.length = 0;
      mailStatus = 202;
      await tick("2026-11-20T14:10:00.000Z");
      assert.deepEqual(seen, []);
    });
  });

  it("checks Dropbox Sign and files the signed PDF once for the owning advisor only", async () => {
    await reset();
    await sql.query("update birthday_settings set enabled = false");
    await sql.query(`insert into signature_requests (advisor_id, request_id, folder, storage, status, signature_provider)
      values (1, 'req-status', '/Unique Advisor/Signed', 'dropbox', 'sent', 'dropbox_sign'),
             (2, 'req-other', '/Unique Advisor/Signed', 'dropbox', 'sent', 'dropbox_sign'),
             (1, 'req-file', '/Unique Advisor/Signed', 'dropbox', 'completed', 'dropbox_sign')`);
    await withEnv(openEnv, async () => {
      const first = await tick("2026-11-21T16:00:00.000Z");
      assert.equal(first.signaturesFiled, 1);
      const statusCall = seen.find((call) => call.url.includes("/signature_request/req-status"));
      const fileCall = seen.find((call) => call.url.includes("/signature_request/files/req-file"));
      const upload = seen.find((call) => call.url.includes("content.dropboxapi.com"));
      assert.equal(statusCall?.authorization, "Bearer sign-advisor-1");
      assert.equal(fileCall?.authorization, "Bearer sign-advisor-1");
      assert.equal(upload?.authorization, "Bearer dropbox-advisor-1");
      assert.equal(seen.some((call) => call.url.includes("req-other")), false);
      const filed = await sql.query<{ filed_signed: string }>("select filed_signed from signature_requests where request_id = 'req-file'");
      assert.match(filed[0]?.filed_signed || "", /^\/Unique Advisor\/Signed\/req-file-signed\.pdf$/);
      const other = await sql.query<{ status: string; filed_signed: string }>("select status, filed_signed from signature_requests where request_id = 'req-other'");
      assert.equal(other[0]?.status, "sent");
      assert.equal(other[0]?.filed_signed, "");
      const blocked = await sql.query<{ detail: string }>("select detail from hosted_jobs where job_key = 'signature-status:2:req-other'");
      assert.match(blocked[0]?.detail || "", /not connected/);
      seen.length = 0;
      const second = await tick("2026-11-21T17:00:00.000Z");
      assert.equal(second.signaturesFiled, 0);
      assert.equal(seen.some((call) => call.url.includes("content.dropboxapi.com")), false);
    });
  });

  it("does not upload again when Dropbox does not confirm the write", async () => {
    await reset();
    await sql.query("update birthday_settings set enabled = false");
    await sql.query(`insert into signature_requests (advisor_id, request_id, folder, storage, status, signature_provider)
      values (1, 'req-unknown', '/Unique Advisor/Signed', 'dropbox', 'completed', 'dropbox_sign')`);
    const failUpload: typeof fetch = async (input, init) => {
      const url = String(input);
      seen.push({ url, authorization: new Headers(init?.headers).get("authorization") || "", body: "" });
      if (url.includes("content.dropboxapi.com")) return new Response("down", { status: 503 });
      if (url.includes("/signature_request/files/")) return new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200 });
      return new Response("", { status: 404 });
    };
    await withEnv(openEnv, async () => {
      await handleJobTick(new Request("https://staging.example/api/jobs/tick", { headers: { authorization: cron } }), {
        now: new Date("2026-11-21T18:00:00.000Z"),
        sql,
        fetchImpl: failUpload,
        secrets,
      });
      const job = await sql.query<{ status: string }>("select status from hosted_jobs where kind = 'signature-file'");
      assert.equal(job[0]?.status, "unknown");
      seen.length = 0;
      await handleJobTick(new Request("https://staging.example/api/jobs/tick", { headers: { authorization: cron } }), {
        now: new Date("2026-11-21T19:00:00.000Z"),
        sql,
        fetchImpl: failUpload,
        secrets,
      });
      assert.deepEqual(seen, []);
    });
  });

  it("blocks production secret lookup before any token read when outbound is blocked", async () => {
    await withEnv({ UA_OUTBOUND_BLOCK: "1" }, async () => {
      const live = productionAdvisorSecrets();
      const mail = await live.microsoftAccess(1);
      const sign = await live.dropboxSignAccess(1);
      const file = await live.dropboxAccess(1);
      assert.equal(mail.ok, false);
      assert.equal(sign.ok, false);
      assert.equal(file.ok, false);
      if (!mail.ok) assert.match(mail.blocked, /Nothing was sent/);
    });
  });

  it("builds the Graph, Dropbox Sign, and Dropbox requests from the adapter itself", async () => {
    const calls: Array<{ url: string; authorization: string }> = [];
    const localFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") || "" });
      if (String(input).includes("/me/sendMail")) return new Response("", { status: 202 });
      if (String(input).includes("/files/")) return new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200 });
      if (String(input).includes("signature_request")) return Response.json({ signature_request: { signature_request_id: "req-9", is_complete: true, signatures: [{ status_code: "signed" }] } });
      if (String(input).includes("content.dropboxapi.com")) return new Response("", { status: 200 });
      return Response.json({ value: [] });
    };
    await withEnv(openEnv, async () => {
      const providers = buildHostedProviders({ secrets, fetchImpl: localFetch });
      const birthday = await providers.birthdayDeliver?.(
        { contactId: "1", name: "Casey Sample", email: "casey.sample@example.invalid", birthday: "1990-11-20", unsubscribed: false },
        { text: "Happy birthday, Casey Sample." },
        { advisorId: 1 },
      );
      assert.equal(birthday?.status, "accepted");
      const missing = await providers.birthdayDeliver?.(
        { contactId: "2", name: "Other Sample", email: "other.sample@example.invalid", birthday: "1990-11-20", unsubscribed: false },
        { text: "no" },
        { advisorId: 2 },
      );
      assert.equal(missing?.status, "failed");
      assert.match(missing?.detail || "", /not connected/);
      const replies = await providers.listReplies?.({ advisorId: 1, conversationId: "thread-1", sentMessageId: "sent-1", sender: "desk@example.invalid" });
      assert.ok(Array.isArray(replies));
      const status = await providers.signatureStatus?.({ advisorId: 1, requestId: "req-9" });
      assert.equal(status?.outcome, "completed");
      const filed = await providers.fileSigned?.({ advisorId: 1, requestId: "req-9", folder: "/Unique Advisor/Signed" });
      assert.equal(filed?.outcome, "accepted");
      assert.match(filed?.path || "", /^\/Unique Advisor\/Signed\//);
      assert.deepEqual(calls.map((call) => call.url.split("?")[0]), [
        "https://graph.microsoft.com/v1.0/me/sendMail",
        "https://graph.microsoft.com/v1.0/me/messages",
        "https://api.hellosign.com/v3/signature_request/req-9",
        "https://api.hellosign.com/v3/signature_request/files/req-9",
        "https://content.dropboxapi.com/2/files/upload",
      ]);
      assert.equal(calls.every((call) => call.authorization.startsWith("Bearer ") && !call.authorization.includes("advisor-2")), true);
    });
  });
});
