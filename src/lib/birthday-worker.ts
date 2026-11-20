/**
 * Persistent birthday job. It stores claims and notices.
 * Live sending stays off: the only delivery function is the one the caller injects.
 * This file does not import a mail, Graph, Zoom, or Dropbox client.
 */

import { peopleFromBirthdaySource, type BirthdayFileReader } from "./birthday-dropbox.ts";
import {
  claimKey,
  missingBirthdayKey,
  personHasBirthday,
  planBirthdayRun,
  previewBirthdayCard,
  summarizeAdvisorNotice,
  type BirthdayPerson,
  type BirthdaySettings,
  type DeliveryStatus,
} from "./birthday-job.ts";
import type { QuerySql } from "./library-store.ts";

export type MockDelivery = {
  status: "accepted" | "failed" | "unknown";
  providerId: string;
};

type SettingsRow = BirthdaySettings & { advisorId: number; lastRunDate: string; sourceRef: string };

const LEASE_MS = 2 * 60 * 1000;

function personFromRow(row: Record<string, unknown>): BirthdayPerson {
  const tags = String(row.tags || "");
  return {
    contactId: String(row.id),
    name: String(row.full_name || ""),
    email: String(row.email || ""),
    birthday: String(row.birthday || ""),
    unsubscribed: tags.split(",").some((tag) => tag.trim().toLowerCase() === "unsubscribed"),
  };
}

function dedupeIdentities(people: BirthdayPerson[]) {
  const seen = new Set<string>();
  const unique: BirthdayPerson[] = [];
  const duplicateContactIds: string[] = [];
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    const emailKey = email.includes("@") ? `email:${email}` : "";
    const idKey = `id:${person.contactId}`;
    if (seen.has(idKey) || (emailKey && seen.has(emailKey))) {
      duplicateContactIds.push(person.contactId);
      continue;
    }
    seen.add(idKey);
    if (emailKey) seen.add(emailKey);
    unique.push(person);
  }
  return { unique, duplicateContactIds };
}

async function reconcileAbandoned(sql: QuerySql, now: Date) {
  const cutoff = new Date(now.getTime() - LEASE_MS).toISOString();
  await sql.query(
    `update birthday_claims
     set status = 'unknown', detail = 'worker restarted before a provider result was stored', updated_at = now()
     where status = 'claimed' and updated_at < $1`,
    [cutoff],
  );
}

async function loadSettings(sql: QuerySql, onlyAdvisorId?: number): Promise<SettingsRow[]> {
  const rows = await sql.query<Record<string, unknown>>(
    onlyAdvisorId
      ? "select * from birthday_settings where advisor_id = $1"
      : "select * from birthday_settings order by advisor_id",
    onlyAdvisorId ? [onlyAdvisorId] : [],
  );
  return rows.map((row) => ({
    advisorId: Number(row.advisor_id),
    enabled: row.enabled === true || row.enabled === "t" || row.enabled === "true",
    source: (row.source === "desk" || row.source === "dropbox" ? row.source : "") as BirthdaySettings["source"],
    timezone: String(row.timezone || "America/Toronto"),
    feb29: row.feb29 === "march1" ? "march1" : "skip",
    templateVersion: Number(row.template_version || 1),
    confirmedVersion: Number(row.confirmed_version || 0),
    cardTitle: String(row.card_title || ""),
    lastRunDate: String(row.last_run_date || ""),
    sourceRef: String(row.source_ref || ""),
  }));
}

async function deskPeople(sql: QuerySql, advisorId: number) {
  const rows = await sql.query<Record<string, unknown>>(
    "select id, full_name, email, tags, birthday from contacts where advisor_id = $1 order by id",
    [advisorId],
  );
  return rows.map(personFromRow);
}

async function claimsFor(sql: QuerySql, advisorId: number) {
  const rows = await sql.query<Record<string, unknown>>(
    "select claim_key, status, provider_id from birthday_claims where advisor_id = $1",
    [advisorId],
  );
  return rows.map((row) => ({
    key: String(row.claim_key),
    status: String(row.status) as DeliveryStatus | "claimed",
    providerId: String(row.provider_id || ""),
  }));
}

async function noticeOnce(sql: QuerySql, advisorId: number, runDate: string, body: string) {
  if (!body.trim()) return;
  const existing = await sql.query(
    "select id from birthday_notices where advisor_id = $1 and run_date = $2 and body = $3 limit 1",
    [advisorId, runDate, body],
  );
  if (existing.length) return;
  await sql.query(
    "insert into birthday_notices (advisor_id, run_date, body) values ($1, $2, $3)",
    [advisorId, runDate, body],
  );
}

async function takeClaim(sql: QuerySql, input: { key: string; advisorId: number; contactId: string; year: string; retry: boolean }) {
  if (input.retry) {
    const rows = await sql.query<{ claim_key: string }>(
      `update birthday_claims set status = 'claimed', detail = 'retry', updated_at = now()
       where claim_key = $1 and status = 'failed'
       returning claim_key`,
      [input.key],
    );
    return rows.length > 0;
  }
  const rows = await sql.query<{ claim_key: string }>(
    `insert into birthday_claims (claim_key, advisor_id, contact_id, occasion_year, status, provider_id, detail)
     values ($1, $2, $3, $4, 'claimed', '', 'in progress')
     on conflict (claim_key) do nothing
     returning claim_key`,
    [input.key, input.advisorId, input.contactId, input.year],
  );
  return rows.length > 0;
}

async function finishClaim(sql: QuerySql, key: string, status: MockDelivery["status"] | "skipped", providerId: string, detail: string) {
  await sql.query(
    "update birthday_claims set status = $2, provider_id = $3, detail = $4, updated_at = now() where claim_key = $1",
    [key, status, providerId, detail],
  );
}

export async function executeBirthdayJob(sql: QuerySql, input: {
  now: Date;
  deliver?: (person: BirthdayPerson, card: { text: string }) => Promise<MockDelivery>;
  dropbox?: BirthdayFileReader;
  advisorId?: number;
}) {
  if (process.env.UA_BIRTHDAY_LIVE === "1") {
    throw new Error("Refusing a live birthday run. Nothing was sent.");
  }
  if (!input.deliver) {
    throw new Error("No delivery function is configured. Nothing was sent.");
  }
  const deliver = input.deliver;
  await reconcileAbandoned(sql, input.now);
  const settingsRows = await loadSettings(sql, input.advisorId);
  const notices: Array<{ advisorId: number; body: string }> = [];
  let providerCalls = 0;
  for (const settings of settingsRows) {
    const localPlan = planBirthdayRun({
      advisorId: settings.advisorId,
      settings,
      people: [],
      claims: [],
      now: input.now,
      lastRunDate: settings.lastRunDate,
    });
    if (!settings.enabled || settings.confirmedVersion !== settings.templateVersion || (settings.source !== "desk" && settings.source !== "dropbox")) {
      await noticeOnce(sql, settings.advisorId, localPlan.local.date, localPlan.notice);
      notices.push({ advisorId: settings.advisorId, body: localPlan.notice });
      continue;
    }
    const loaded = await peopleFromBirthdaySource({
      source: settings.source,
      sourceRef: settings.sourceRef,
      advisorId: settings.advisorId,
      deskPeople: settings.source === "desk" ? await deskPeople(sql, settings.advisorId) : [],
      dropbox: input.dropbox,
    });
    if (loaded.error) {
      await noticeOnce(sql, settings.advisorId, localPlan.local.date, loaded.error);
      notices.push({ advisorId: settings.advisorId, body: loaded.error });
      continue;
    }
    const { unique, duplicateContactIds } = dedupeIdentities(loaded.people);
    const claims = await claimsFor(sql, settings.advisorId);
    const planned = planBirthdayRun({
      advisorId: settings.advisorId,
      settings,
      people: unique,
      claims,
      now: input.now,
      lastRunDate: settings.lastRunDate,
    });
    const sameDayRetry = planned.window === "already_today";
    const retryToday = sameDayRetry
      ? unique
        .filter((person) => personHasBirthday(person, planned.local, settings.feb29)
          && claims.some((claim) => claim.key === claimKey(settings.advisorId, person.contactId, planned.local.year) && claim.status === "failed"))
        .map((person) => ({ contactId: person.contactId, name: person.name, email: person.email, action: "retry" as const, reason: "earlier attempt failed" }))
      : [];
    const due = planned.window === "run"
      ? planned.recipients.filter((item) => item.action === "send" || item.action === "retry")
      : retryToday;
    const outcomes: Array<{ name: string; outcome: string }> = [];
    for (const item of due) {
      const key = claimKey(settings.advisorId, item.contactId, planned.local.year);
      const owned = await takeClaim(sql, { key, advisorId: settings.advisorId, contactId: item.contactId, year: planned.local.year, retry: item.action === "retry" });
      if (!owned) continue;
      const person = unique.find((candidate) => candidate.contactId === item.contactId);
      if (!person) continue;
      let result: MockDelivery;
      try {
        providerCalls += 1;
        result = await deliver(person, previewBirthdayCard(settings.cardTitle || "Happy birthday, {{name}}.", person));
      } catch {
        result = { status: "unknown", providerId: "" };
      }
      await finishClaim(sql, key, result.status, result.providerId, result.status === "accepted" ? "provider accepted; delivery not confirmed" : result.status);
      outcomes.push({ name: person.name, outcome: result.status });
    }
    for (const missing of planned.missingDates.filter((item) => !item.repeat)) {
      const key = missingBirthdayKey(settings.advisorId, missing.contactId);
      await sql.query(
        `insert into birthday_claims (claim_key, advisor_id, contact_id, occasion_year, status, detail)
         values ($1, $2, $3, '', 'skipped', 'missing birthday')
         on conflict (claim_key) do nothing`,
        [key, settings.advisorId, missing.contactId],
      );
    }
    const missingLine = planned.missingDates.some((item) => !item.repeat)
      ? `Missing birthday dates, shown once: ${planned.missingDates.filter((item) => !item.repeat).map((item) => item.name).join(", ")}. No birthday was guessed.`
      : "";
    const notice = [
      outcomes.length ? summarizeAdvisorNotice(outcomes) : planned.notice,
      duplicateContactIds.length ? `Duplicate source identities were not sent twice: ${duplicateContactIds.join(", ")}.` : "",
      outcomes.length ? missingLine : "",
    ].filter(Boolean).join(" ");
    if (planned.window === "run") {
      await sql.query("update birthday_settings set last_run_date = $2, updated_at = now() where advisor_id = $1", [settings.advisorId, planned.local.date]);
    }
    await noticeOnce(sql, settings.advisorId, planned.local.date, notice);
    notices.push({ advisorId: settings.advisorId, body: notice });
  }
  return { live: false as const, providerCalls, notices };
}
