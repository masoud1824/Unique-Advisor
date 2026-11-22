import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { claimJob, ensureDispatchTables, reconcileClaims, runHostedDispatch } from "./hosted-dispatch.ts";
import type { QuerySql } from "./library-store.ts";

const dir = `/opt/ua-release/data/hosted-dispatch-test-${process.pid}`;
let pg: PGlite;
let sql: QuerySql;
const network: string[] = [];

function wrap(database: PGlite): QuerySql {
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const result = await database.query<T>(text, params);
      return result.rows as T[];
    },
  };
}

async function reset() {
  network.length = 0;
  await sql.query("delete from hosted_jobs");
  await sql.query("delete from drip_recipient_outcomes");
  await sql.query("delete from document_mail_replies");
  await sql.query("delete from document_mail_threads");
  await sql.query("delete from signature_events");
  await sql.query("delete from signature_requests");
  await sql.query("delete from birthday_notices");
  await sql.query("delete from birthday_claims");
  await sql.query("delete from drip_campaigns");
  await sql.query("update birthday_settings set enabled = true, source = 'desk', confirmed_version = 1, template_version = 1, last_run_date = '', timezone = 'America/Toronto'");
  await sql.query("update contacts set birthday = '1990-11-20', email = 'casey.sample@example.invalid', tags = '' where id = 1");
}

describe("hosted job dispatch", () => {
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
    await sql.query("insert into advisors (slug) values ('staging-practice')");
    await sql.query("insert into contacts (advisor_id, full_name, email, tags, birthday) values (1, 'Casey Sample', 'casey.sample@example.invalid', '', '1990-11-20')");
    await sql.query(`insert into birthday_settings (advisor_id, enabled, source, timezone, card_title, template_version, confirmed_version)
      values (1, true, 'desk', 'America/Toronto', 'Happy birthday, {{name}}.', 1, 1)`);
    await ensureDispatchTables(sql);
  });

  after(async () => {
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("does not call the birthday provider until the advisor has confirmed that version", async () => {
    await reset();
    await sql.query("update birthday_settings set confirmed_version = 0");
    const result = await runHostedDispatch(sql, {
      now: new Date("2026-11-20T14:00:00.000Z"),
      outboundBlocked: false,
      providers: { birthdayDeliver: async (person) => { network.push(person.name); return { status: "accepted", providerId: "b1" }; } },
    });
    assert.equal(result.birthdays.providerCalls, 0);
    assert.deepEqual(network, []);
  });

  it("dispatches one birthday through the mock provider and does not send it again", async () => {
    await reset();
    const now = new Date("2026-11-20T14:00:00.000Z");
    const providers = { birthdayDeliver: async (person: { name: string }) => { network.push(`birthday:${person.name}`); return { status: "accepted" as const, providerId: "b1" }; } };
    const first = await runHostedDispatch(sql, { now, outboundBlocked: false, providers });
    const second = await runHostedDispatch(sql, { now, outboundBlocked: false, providers });
    assert.equal(first.birthdays.providerCalls, 1);
    assert.equal(second.birthdays.providerCalls, 0);
    assert.deepEqual(network, ["birthday:Casey Sample"]);
    const claims = await sql.query<{ status: string }>("select status from birthday_claims");
    assert.equal(claims[0]?.status, "accepted");
  });

  it("uses the advisor timezone, including a half-hour offset, and ignores a whole-hour tick that is still 8:30 there", async () => {
    await reset();
    await sql.query("update birthday_settings set timezone = 'America/St_Johns'");
    const providers = { birthdayDeliver: async () => { network.push("birthday"); return { status: "accepted" as const, providerId: "b1" }; } };
    const tooSoon = await runHostedDispatch(sql, {
      now: new Date("2026-11-20T12:00:00.000Z"),
      outboundBlocked: false,
      providers,
    });
    assert.equal(tooSoon.birthdays.providerCalls, 0);
    const onTime = await runHostedDispatch(sql, {
      now: new Date("2026-11-20T12:30:00.000Z"),
      outboundBlocked: false,
      providers,
    });
    assert.equal(onTime.birthdays.providerCalls, 1);
    assert.deepEqual(network, ["birthday"]);
  });

  it("fails closed when outbound is blocked and does not call the injected provider", async () => {
    await reset();
    const result = await runHostedDispatch(sql, {
      now: new Date("2026-11-20T14:00:00.000Z"),
      outboundBlocked: true,
      providers: { birthdayDeliver: async () => { network.push("live"); return { status: "accepted", providerId: "live" }; } },
    });
    assert.equal(result.blocked, true);
    assert.equal(result.sent, 0);
    assert.deepEqual(network, []);
    const claims = await sql.query<{ status: string }>("select status from birthday_claims");
    assert.equal(claims[0]?.status, "failed");
  });

  it("advances a drip only after the mock accepts, and an unknown result is not retried or advanced", async () => {
    await reset();
    await sql.query(`insert into drip_campaigns (advisor_id, name, steps, active, next_index, contact_ids)
      values (1, 'Welcome', $1, true, 0, '[1]')`, [
      JSON.stringify([{ title: "Welcome", body: "Hello" }, { title: "Next", body: "Later" }]),
    ]);
    let mode: "unknown" | "ok" = "unknown";
    const providers = {
      dripSend: async () => {
        network.push(`drip:${mode}`);
        return mode === "unknown" ? { ok: false, unknown: true } : { ok: true };
      },
    };
    const unknown = await runHostedDispatch(sql, { now: new Date("2026-11-21T15:00:00.000Z"), outboundBlocked: false, providers });
    assert.equal(unknown.drips.advanced, 0);
    const again = await runHostedDispatch(sql, { now: new Date("2026-11-21T15:05:00.000Z"), outboundBlocked: false, providers });
    assert.equal(again.drips.calls, 0);
    assert.deepEqual(network, ["drip:unknown"]);
    const step = await sql.query<{ next_index: number }>("select next_index from drip_campaigns");
    assert.equal(Number(step[0]?.next_index), 0);
    mode = "ok";
    await sql.query("delete from drip_recipient_outcomes");
    await sql.query("update hosted_jobs set status = 'failed' where kind = 'drip'");
    const accepted = await runHostedDispatch(sql, { now: new Date("2026-11-21T16:00:00.000Z"), outboundBlocked: false, providers });
    assert.equal(accepted.drips.advanced, 1);
    const moved = await sql.query<{ next_index: number }>("select next_index from drip_campaigns");
    assert.equal(Number(moved[0]?.next_index), 1);
  });

  it("stores one reply notice and ignores the same message from a second tick", async () => {
    await reset();
    await sql.query(`insert into document_mail_threads (advisor_id, conversation_id, sent_message_id, sender)
      values (1, 'thread-1', 'sent-1', 'desk@example.invalid')`);
    const providers = {
      listReplies: async () => {
        network.push("mailbox");
        return [{ id: "reply-1", conversationId: "thread-1", from: "casey.sample@example.invalid" }];
      },
    };
    const first = await runHostedDispatch(sql, { now: new Date("2026-11-21T15:00:00.000Z"), outboundBlocked: false, providers });
    const second = await runHostedDispatch(sql, { now: new Date("2026-11-21T15:00:30.000Z"), outboundBlocked: false, providers });
    assert.equal(first.replies.stored, 1);
    assert.equal(second.replies.stored, 0);
    assert.deepEqual(network, ["mailbox"]);
    const rows = await sql.query("select message_id from document_mail_replies");
    assert.equal(rows.length, 1);
  });

  it("retries a reply that crashed before it was stored, and does not store a second copy after it was stored", async () => {
    await reset();
    await sql.query(`insert into document_mail_threads (advisor_id, conversation_id, sent_message_id, sender)
      values (1, 'thread-1', 'sent-1', 'desk@example.invalid')`);
    await sql.query(`insert into hosted_jobs (job_key, kind, advisor_id, status, attempt, lease_until, provider_id)
      values ('reply:1:reply-9', 'reply', 1, 'claimed', 1, '2026-11-21T14:00:00.000Z', 'reply-9')`);
    await reconcileClaims(sql, new Date("2026-11-21T15:00:00.000Z"));
    const recovered = await sql.query<{ status: string }>("select status from hosted_jobs where job_key = 'reply:1:reply-9'");
    assert.equal(recovered[0]?.status, "failed");
    await sql.query(`insert into document_mail_replies (advisor_id, message_id, body) values (1, 'reply-8', 'already stored')`);
    await sql.query(`insert into hosted_jobs (job_key, kind, advisor_id, status, attempt, lease_until, provider_id)
      values ('reply:1:reply-8', 'reply', 1, 'claimed', 1, '2026-11-21T14:00:00.000Z', 'reply-8')`);
    await reconcileClaims(sql, new Date("2026-11-21T15:00:00.000Z"));
    const kept = await sql.query<{ status: string }>("select status from hosted_jobs where job_key = 'reply:1:reply-8'");
    assert.equal(kept[0]?.status, "unknown");
    const rows = await sql.query("select message_id from document_mail_replies");
    assert.equal(rows.length, 1);
  });

  it("lets only one of two concurrent claims own a job", async () => {
    await reset();
    const now = new Date("2026-11-21T15:00:00.000Z");
    const [left, right] = await Promise.all([
      claimJob(sql, { key: "drip:9:0", kind: "drip", advisorId: 1, now }),
      claimJob(sql, { key: "drip:9:0", kind: "drip", advisorId: 1, now }),
    ]);
    const winners = [left, right].filter(Boolean);
    assert.equal(winners.length, 1);
  });

  it("files a completed Dropbox Sign request once and does not touch another signature provider", async () => {
    await reset();
    await sql.query(`insert into signature_requests (advisor_id, request_id, folder, storage, status, signature_provider)
      values (1, 'req-1', '/Unique Advisor/Signed', 'dropbox', 'completed', 'dropbox_sign'),
             (1, 'adobe-1', '/other', 'box', 'sent', 'adobe_sign')`);
    const providers = {
      fileSigned: async (row: { requestId: string }) => {
        network.push(row.requestId);
        return { outcome: "accepted" as const, path: "/Unique Advisor/Signed/req-1.pdf" };
      },
      signatureStatus: async () => { network.push("status"); return { outcome: "completed" as const, providerId: "evt" }; },
    };
    const first = await runHostedDispatch(sql, { now: new Date("2026-11-21T15:00:00.000Z"), outboundBlocked: false, providers });
    const second = await runHostedDispatch(sql, { now: new Date("2026-11-21T16:00:00.000Z"), outboundBlocked: false, providers });
    assert.equal(first.signatures.filed, 1);
    assert.equal(first.signatures.skippedOtherProviders, 1);
    assert.equal(second.signatures.filed, 0);
    assert.deepEqual(network, ["req-1"]);
    const filed = await sql.query<{ filed_signed: string }>("select filed_signed from signature_requests where request_id = 'req-1'");
    assert.equal(filed[0]?.filed_signed, "/Unique Advisor/Signed/req-1.pdf");
  });

  it("does not file again when Dropbox Sign's outcome is unknown", async () => {
    await reset();
    await sql.query(`insert into signature_requests (advisor_id, request_id, folder, storage, status, signature_provider)
      values (1, 'req-2', '/Unique Advisor/Signed', 'dropbox', 'sent', 'dropbox_sign')`);
    const providers = {
      signatureStatus: async () => { network.push("status"); return { outcome: "unknown" as const, providerId: "" }; },
      fileSigned: async () => { network.push("file"); return { outcome: "accepted" as const, path: "/should-not.pdf" }; },
    };
    await runHostedDispatch(sql, { now: new Date("2026-11-21T15:00:00.000Z"), outboundBlocked: false, providers });
    await runHostedDispatch(sql, { now: new Date("2026-11-21T16:00:00.000Z"), outboundBlocked: false, providers });
    assert.deepEqual(network, ["status"]);
    const row = await sql.query<{ status: string; filed_signed: string }>("select status, filed_signed from signature_requests where request_id = 'req-2'");
    assert.equal(row[0]?.status, "sent");
    assert.equal(row[0]?.filed_signed, "");
  });

  it("ignores a duplicate signature callback", async () => {
    await reset();
    await sql.query(`insert into signature_requests (advisor_id, request_id, folder, storage, status, signature_provider)
      values (1, 'req-3', '/Unique Advisor/Signed', 'dropbox', 'sent', 'dropbox_sign')`);
    const providers = {
      signatureStatus: async () => { network.push("status"); return { outcome: "waiting" as const, providerId: "same-event" }; },
    };
    await runHostedDispatch(sql, { now: new Date("2026-11-21T15:00:00.000Z"), outboundBlocked: false, providers });
    await sql.query("update hosted_jobs set not_before = null, status = 'pending' where kind = 'signature-status'");
    await runHostedDispatch(sql, { now: new Date("2026-11-21T15:20:00.000Z"), outboundBlocked: false, providers });
    const events = await sql.query("select event_hash from signature_events");
    assert.equal(events.length, 1);
    assert.equal(network.length, 2);
  });

  it("does not upload a signed file again when the Dropbox outcome was unknown", async () => {
    await reset();
    await sql.query(`insert into signature_requests (advisor_id, request_id, folder, storage, status, signature_provider)
      values (1, 'req-unknown', '/Unique Advisor/Signed', 'dropbox', 'completed', 'dropbox_sign')`);
    const providers = {
      fileSigned: async () => { network.push("file"); return { outcome: "unknown" as const }; },
    };
    await runHostedDispatch(sql, { now: new Date("2026-11-21T15:00:00.000Z"), outboundBlocked: false, providers });
    await runHostedDispatch(sql, { now: new Date("2026-11-21T16:00:00.000Z"), outboundBlocked: false, providers });
    assert.deepEqual(network, ["file"]);
    const row = await sql.query<{ status: string; filed_signed: string }>("select status, filed_signed from signature_requests where request_id = 'req-unknown'");
    assert.equal(row[0]?.filed_signed, "");
    const job = await sql.query<{ status: string }>("select status from hosted_jobs where kind = 'signature-file'");
    assert.equal(job[0]?.status, "unknown");
  });

  it("does not resend a drip after the worker disappeared with the claim still open", async () => {
    await reset();
    const inserted = await sql.query<{ id: number }>(
      `insert into drip_campaigns (advisor_id, name, steps, active, next_index, contact_ids)
       values (1, 'Welcome', $1, true, 0, '[1]') returning id`,
      [JSON.stringify([{ title: "Welcome", body: "Hello" }])],
    );
    const id = Number(inserted[0]?.id);
    await sql.query(
      `insert into hosted_jobs (job_key, kind, advisor_id, status, attempt, lease_until)
       values ($1, 'drip', 1, 'claimed', 1, '2026-11-21T14:00:00.000Z')`,
      [`drip:${id}:0`],
    );
    const providers = { dripSend: async () => { network.push("drip"); return { ok: true }; } };
    const result = await runHostedDispatch(sql, { now: new Date("2026-11-21T15:00:00.000Z"), outboundBlocked: false, providers });
    assert.equal(result.drips.calls, 0);
    assert.deepEqual(network, []);
    const job = await sql.query<{ status: string }>("select status from hosted_jobs where kind = 'drip'");
    assert.equal(job[0]?.status, "unknown");
    const step = await sql.query<{ next_index: number }>("select next_index from drip_campaigns where id = $1", [id]);
    assert.equal(Number(step[0]?.next_index), 0);
  });

  it("does not call the injected birthday provider when the mail budget is closed", async () => {
    await reset();
    const previous = process.env.UA_BUDGET_HALT_MAIL;
    process.env.UA_BUDGET_HALT_MAIL = "1";
    try {
      const result = await runHostedDispatch(sql, {
        now: new Date("2026-11-20T14:00:00.000Z"),
        outboundBlocked: false,
        providers: { birthdayDeliver: async () => { network.push("birthday"); return { status: "accepted", providerId: "live" }; } },
      });
      assert.equal(result.birthdays.providerCalls, 0);
      assert.equal(result.sent, 0);
      assert.deepEqual(network, []);
      const claims = await sql.query<{ status: string }>("select status from birthday_claims");
      assert.equal(claims[0]?.status, "failed");
    } finally {
      if (previous === undefined) delete process.env.UA_BUDGET_HALT_MAIL;
      else process.env.UA_BUDGET_HALT_MAIL = previous;
    }
  });
});
