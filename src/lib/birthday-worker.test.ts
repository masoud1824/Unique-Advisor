import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { dropboxBirthdayReady } from "./birthday-dropbox.ts";
import { executeBirthdayJob } from "./birthday-worker.ts";
import type { BirthdayPerson } from "./birthday-job.ts";
import type { QuerySql } from "./library-store.ts";

const dir = `/opt/ua-release/data/birthday-worker-test-${process.pid}`;
let pg: PGlite;
let sql: QuerySql;
const calls: string[] = [];
let mode: "ok" | "fail-jordan" | "unknown" | "throw" = "ok";

function wrap(database: PGlite): QuerySql {
  return {
    async query(text, params = []) {
      const result = await database.query(text, params);
      return result.rows;
    },
  };
}

async function deliver(person: BirthdayPerson) {
  calls.push(person.name);
  if (mode === "throw") throw new Error("provider socket closed");
  if (mode === "unknown") return { status: "unknown" as const, providerId: "" };
  if (mode === "fail-jordan" && person.name.includes("Jordan")) return { status: "failed" as const, providerId: "" };
  return { status: "accepted" as const, providerId: "mock-accepted" };
}

async function reset() {
  calls.length = 0;
  mode = "ok";
  await sql.query("delete from birthday_notices");
  await sql.query("delete from birthday_claims");
  await sql.query("delete from contacts where full_name in ('Jordan Example', 'No Date Sample', 'Same Email')");
  await sql.query("update contacts set birthday = '1990-11-20', email = 'casey.sample@example.invalid' where full_name = 'Casey Sample'");
  await sql.query(`update birthday_settings set enabled = true, source = 'desk', source_ref = '', feb29 = 'skip',
    template_version = 1, confirmed_version = 1, last_run_date = '', timezone = 'America/Toronto'`);
}

describe("birthday worker persistence", () => {
  before(async () => {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    pg = new PGlite(dir);
    await pg.waitReady;
    sql = wrap(pg);
    await pg.exec(`
      create table advisors (id serial primary key, slug text not null, practice_name text not null default '', advisor_name text not null default '');
      create table contacts (
        id serial primary key, advisor_id integer not null, full_name text not null,
        email text not null default '', tags text not null default '', birthday text not null default ''
      );
      create table birthday_settings (
        advisor_id integer primary key references advisors(id),
        enabled boolean not null default false,
        source text not null default '',
        timezone text not null default 'America/Toronto',
        feb29 text not null default 'skip',
        card_title text not null default '',
        template_version integer not null default 1,
        confirmed_version integer not null default 0,
        last_run_date text not null default '',
        source_ref text not null default '',
        updated_at timestamptz not null default now()
      );
      create table birthday_claims (
        claim_key text primary key,
        advisor_id integer not null,
        contact_id text not null,
        occasion_year text not null,
        status text not null,
        provider_id text not null default '',
        detail text not null default '',
        updated_at timestamptz not null default now()
      );
      create table birthday_notices (
        id serial primary key,
        advisor_id integer not null,
        run_date text not null,
        body text not null,
        created_at timestamptz not null default now()
      );
    `);
    await sql.query("insert into advisors (slug, practice_name, advisor_name) values ('one', 'One', 'One'), ('two', 'Two', 'Two')");
    await sql.query(
      `insert into contacts (advisor_id, full_name, email, tags, birthday) values
       (1, 'Casey Sample', 'casey.sample@example.invalid', '', '1990-11-20'),
       (2, 'Morgan Sample', 'morgan.sample@example.invalid', '', '1990-11-21')`,
    );
    await sql.query(
      `insert into birthday_settings (advisor_id, enabled, source, timezone, feb29, card_title, template_version, confirmed_version, last_run_date, source_ref)
       values (1, true, 'desk', 'America/Toronto', 'skip', 'Happy birthday, {{name}}.', 1, 1, '', ''),
              (2, true, 'desk', 'America/Toronto', 'skip', 'Happy birthday, {{name}}.', 1, 1, '', '')`,
    );
  });

  after(async () => {
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("stays off until enabled and does not call the mock provider", async () => {
    await reset();
    await sql.query("update birthday_settings set enabled = false");
    const result = await executeBirthdayJob(sql, { now: new Date("2026-11-20T14:00:00.000Z"), deliver });
    assert.equal(result.providerCalls, 0);
    assert.equal(calls.length, 0);
    assert.match(result.notices.map((item) => item.body).join("\n"), /off/);
  });

  it("sends through the mock provider once for two workers and records acceptance", async () => {
    await reset();
    const now = new Date("2026-11-20T14:00:00.000Z");
    const [first, second] = await Promise.all([
      executeBirthdayJob(sql, { now, deliver, advisorId: 1 }),
      executeBirthdayJob(sql, { now, deliver, advisorId: 1 }),
    ]);
    assert.equal(first.providerCalls + second.providerCalls, 1);
    assert.deepEqual(calls, ["Casey Sample"]);
    const claim = await sql.query<{ status: string; provider_id: string }>("select status, provider_id from birthday_claims where contact_id = (select id::text from contacts where full_name = 'Casey Sample')");
    assert.equal(claim[0].status, "accepted");
    assert.equal(claim[0].provider_id, "mock-accepted");
    const notice = await sql.query<{ body: string }>("select body from birthday_notices where advisor_id = 1");
    assert.match(notice.map((row) => row.body).join("\n"), /Casey Sample/);
    assert.doesNotMatch(notice.map((row) => row.body).join("\n"), /all sent/i);
    const other = await sql.query<{ body: string }>("select body from birthday_notices where advisor_id = 2");
    assert.equal(other.some((row) => row.body.includes("Casey Sample")), false);
  });

  it("retries a failed card the same day and holds an unknown result", async () => {
    await reset();
    await sql.query("insert into contacts (advisor_id, full_name, email, tags, birthday) values (1, 'Jordan Example', 'jordan.example@example.invalid', '', '1990-11-20')");
    mode = "fail-jordan";
    const now = new Date("2026-11-20T14:00:00.000Z");
    await executeBirthdayJob(sql, { now, deliver, advisorId: 1 });
    assert.equal(calls.filter((name) => name === "Jordan Example").length, 1);
    calls.length = 0;
    mode = "ok";
    await executeBirthdayJob(sql, { now, deliver, advisorId: 1 });
    assert.deepEqual(calls, ["Jordan Example"]);
    const jordan = await sql.query<{ status: string }>("select status from birthday_claims where contact_id = (select id::text from contacts where full_name = 'Jordan Example')");
    assert.equal(jordan[0].status, "accepted");
    await reset();
    mode = "unknown";
    await executeBirthdayJob(sql, { now, deliver, advisorId: 1 });
    calls.length = 0;
    mode = "ok";
    const again = await executeBirthdayJob(sql, { now, deliver, advisorId: 1 });
    assert.equal(again.providerCalls, 0);
    assert.equal(calls.length, 0);
    const held = await sql.query<{ status: string }>("select status from birthday_claims where advisor_id = 1 and status = 'unknown'");
    assert.equal(held.length, 1);
  });

  it("turns an abandoned claim into unknown on restart and does not send it again", async () => {
    await reset();
    const casey = await sql.query<{ id: number }>("select id from contacts where full_name = 'Casey Sample'");
    await sql.query(
      `insert into birthday_claims (claim_key, advisor_id, contact_id, occasion_year, status, detail, updated_at)
       values ($1, 1, $2, '2026', 'claimed', 'in progress', '2020-01-01T00:00:00.000Z')`,
      [`1:${casey[0].id}:birthday:2026`, String(casey[0].id)],
    );
    const result = await executeBirthdayJob(sql, { now: new Date("2026-11-20T14:00:00.000Z"), deliver, advisorId: 1 });
    assert.equal(result.providerCalls, 0);
    const status = await sql.query<{ status: string; detail: string }>("select status, detail from birthday_claims where advisor_id = 1");
    assert.equal(status[0].status, "unknown");
    assert.match(status[0].detail, /restarted/);
  });

  it("collapses duplicate identities, pauses for reconfirmation, and reports a missing date once", async () => {
    await reset();
    await sql.query("insert into contacts (advisor_id, full_name, email, tags, birthday) values (1, 'Same Email', 'casey.sample@example.invalid', '', '1990-11-20')");
    const now = new Date("2026-11-20T14:00:00.000Z");
    const doubled = await executeBirthdayJob(sql, { now, deliver, advisorId: 1 });
    assert.equal(doubled.providerCalls, 1);
    assert.match(doubled.notices.map((item) => item.body).join("\n"), /Duplicate source identities/);
    await reset();
    await sql.query("update birthday_settings set template_version = 2, confirmed_version = 1 where advisor_id = 1");
    const paused = await executeBirthdayJob(sql, { now, deliver, advisorId: 1 });
    assert.equal(paused.providerCalls, 0);
    assert.match(paused.notices[0].body, /Turn the birthday check on again/);
    await reset();
    await sql.query("insert into contacts (advisor_id, full_name, email, tags, birthday) values (1, 'No Date Sample', 'nodate@example.invalid', '', '')");
    const first = await executeBirthdayJob(sql, { now, deliver, advisorId: 1 });
    assert.match(first.notices.map((item) => item.body).join("\n"), /No Date Sample/);
    const second = await executeBirthdayJob(sql, { now, deliver, advisorId: 1 });
    const notes = await sql.query("select id from birthday_notices where advisor_id = 1 and body like '%No Date Sample%'");
    assert.equal(notes.length, 1);
    assert.equal(second.providerCalls, 0);
  });

  it("follows Toronto winter, summer, February 29, and same-day catch-up without backfilling missed days", async () => {
    await reset();
    await sql.query("update contacts set birthday = '1990-03-08' where full_name = 'Casey Sample'");
    const summer = await executeBirthdayJob(sql, { now: new Date("2026-03-08T13:00:00.000Z"), deliver, advisorId: 1 });
    assert.equal(summer.providerCalls, 1);
    await reset();
    await sql.query("update contacts set birthday = '1990-03-08' where full_name = 'Casey Sample'");
    const early = await executeBirthdayJob(sql, { now: new Date("2026-03-08T12:30:00.000Z"), deliver, advisorId: 1 });
    assert.equal(early.providerCalls, 0);
    await reset();
    await sql.query("update contacts set birthday = '1990-11-01' where full_name = 'Casey Sample'");
    const winter = await executeBirthdayJob(sql, { now: new Date("2026-11-01T14:00:00.000Z"), deliver, advisorId: 1 });
    assert.equal(winter.providerCalls, 1);
    await reset();
    await sql.query("update contacts set birthday = '1992-02-29' where full_name = 'Casey Sample'");
    const skipped = await executeBirthdayJob(sql, { now: new Date("2027-03-01T14:00:00.000Z"), deliver, advisorId: 1 });
    assert.equal(skipped.providerCalls, 0);
    await sql.query("update birthday_settings set feb29 = 'march1', last_run_date = '' where advisor_id = 1");
    await sql.query("delete from birthday_claims");
    const march = await executeBirthdayJob(sql, { now: new Date("2027-03-01T14:00:00.000Z"), deliver, advisorId: 1 });
    assert.equal(march.providerCalls, 1);
    await reset();
    await sql.query("update birthday_settings set last_run_date = '2026-11-19' where advisor_id = 1");
    const catchUp = await executeBirthdayJob(sql, { now: new Date("2026-11-20T16:00:00.000Z"), deliver, advisorId: 1 });
    assert.equal(catchUp.providerCalls, 1);
    await reset();
    await sql.query("update birthday_settings set last_run_date = '2026-11-17' where advisor_id = 1");
    const missed = await executeBirthdayJob(sql, { now: new Date("2026-11-20T16:00:00.000Z"), deliver, advisorId: 1 });
    assert.equal(missed.providerCalls, 0);
    assert.match(missed.notices.map((item) => item.body).join("\n"), /Missed days were not sent/);
  });

  it("does not call Dropbox and uses an injected file only when one is supplied", async () => {
    await reset();
    assert.equal(dropboxBirthdayReady().ready, false);
    assert.equal(dropboxBirthdayReady().contactedDropbox, false);
    await sql.query("update birthday_settings set source = 'dropbox', source_ref = '' where advisor_id = 1");
    const blocked = await executeBirthdayJob(sql, { now: new Date("2026-11-20T14:00:00.000Z"), deliver, advisorId: 1 });
    assert.equal(blocked.providerCalls, 0);
    assert.match(blocked.notices[0].body, /will not call Dropbox/);
    await sql.query("update birthday_settings set source = 'dropbox', source_ref = 'file-1', last_run_date = '' where advisor_id = 1");
    await sql.query("delete from birthday_notices where advisor_id = 1");
    const fromFile = await executeBirthdayJob(sql, {
      now: new Date("2026-11-20T14:00:00.000Z"),
      deliver,
      advisorId: 1,
      dropbox: async () => ({ people: [{ contactId: "file-casey", name: "File Casey", email: "file.casey@example.invalid", birthday: "1990-11-20", unsubscribed: false }] }),
    });
    assert.deepEqual(calls, ["File Casey"]);
    assert.equal(fromFile.providerCalls, 1);
  });

  it("refuses a live run before the mock provider is called", async () => {
    await reset();
    process.env.UA_BIRTHDAY_LIVE = "1";
    try {
      await assert.rejects(() => executeBirthdayJob(sql, { now: new Date("2026-11-20T14:00:00.000Z"), deliver, advisorId: 1 }), /live birthday/);
      assert.equal(calls.length, 0);
    } finally {
      delete process.env.UA_BIRTHDAY_LIVE;
    }
  });
});
