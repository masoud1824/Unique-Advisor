#!/usr/bin/env node
/** Birthday worker entry. Refuses live mail. Does not start a timer. */
import { mkdir, rm } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { planBirthdayRun } from "../../src/lib/birthday-job.ts";
import { executeBirthdayJob } from "../../src/lib/birthday-worker.ts";
import { outboundBlocked } from "../../src/lib/outbound-guard.ts";

if (process.env.UA_BIRTHDAY_LIVE === "1") {
  console.error("Refusing a live birthday run. This task does not activate sending.");
  process.exit(2);
}
if (!outboundBlocked()) {
  console.error("Refusing to plan birthdays unless outbound sending is already blocked.");
  process.exit(2);
}

if (process.env.UA_BIRTHDAY_EXECUTE === "1") {
  const dir = "/opt/ua-release/data/birthday-worker-entry";
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.waitReady;
  await pg.exec(`
    create table advisors (id serial primary key, slug text not null, practice_name text not null default '', advisor_name text not null default '');
    create table contacts (id serial primary key, advisor_id integer not null, full_name text not null, email text not null default '', tags text not null default '', birthday text not null default '');
    create table birthday_settings (
      advisor_id integer primary key, enabled boolean not null default false, source text not null default '',
      timezone text not null default 'America/Toronto', feb29 text not null default 'skip', card_title text not null default '',
      template_version integer not null default 1, confirmed_version integer not null default 0,
      last_run_date text not null default '', source_ref text not null default '', updated_at timestamptz not null default now()
    );
    create table birthday_claims (
      claim_key text primary key, advisor_id integer not null, contact_id text not null, occasion_year text not null,
      status text not null, provider_id text not null default '', detail text not null default '', updated_at timestamptz not null default now()
    );
    create table birthday_notices (id serial primary key, advisor_id integer not null, run_date text not null, body text not null, created_at timestamptz not null default now());
  `);
  await pg.query("insert into advisors (slug, practice_name, advisor_name) values ('entry', 'Entry', 'Entry')");
  await pg.query("insert into contacts (advisor_id, full_name, email, birthday) values (1, 'Casey Sample', 'casey.sample@example.invalid', '1990-11-20')");
  await pg.query("insert into birthday_settings (advisor_id, enabled, source, card_title, template_version, confirmed_version) values (1, false, 'desk', 'Happy birthday, {{name}}.', 1, 0)");
  const sql = { query: async (text, params = []) => (await pg.query(text, params)).rows };
  const off = await executeBirthdayJob(sql, { now: new Date("2026-11-20T14:00:00.000Z"), deliver: async () => ({ status: "accepted", providerId: "mock" }) });
  await pg.query("update birthday_settings set enabled = true, confirmed_version = 1 where advisor_id = 1");
  const on = await executeBirthdayJob(sql, { now: new Date("2026-11-20T14:00:00.000Z"), deliver: async () => ({ status: "accepted", providerId: "mock-entry" }) });
  const claims = await pg.query("select status, provider_id from birthday_claims");
  console.log(JSON.stringify({ live: false, timer: false, offCalls: off.providerCalls, onCalls: on.providerCalls, claims: claims.rows }));
  await pg.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
}

const now = new Date(process.env.UA_BIRTHDAY_NOW || "2026-11-20T14:00:00.000Z");
const plan = planBirthdayRun({
  advisorId: 0,
  settings: {
    enabled: false,
    source: "",
    timezone: process.env.UA_BIRTHDAY_ZONE || "America/Toronto",
    feb29: "skip",
    templateVersion: 1,
    confirmedVersion: 0,
    cardTitle: "",
  },
  people: [],
  claims: [],
  now,
  lastRunDate: "",
});
console.log(JSON.stringify({ live: false, sent: false, worker: false, notice: plan.notice, recipients: plan.recipients }));
