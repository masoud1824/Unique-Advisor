/** Advisor birthday settings. This module stores and previews only. It does not schedule or send. */

import { dropboxBirthdayReady } from "./birthday-dropbox.ts";
import {
  planBirthdayRun,
  previewBirthdayCard,
  type BirthdaySettings,
  type BirthdayPerson,
} from "./birthday-job.ts";

export type BirthdaySql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const BIRTHDAY_AUTOMATION_OFF =
  "Birthday automation stays off in this copy. Nothing was scheduled and nothing was sent.";

export const BIRTHDAY_READINESS = {
  codeReady: true,
  schedulerReady: false,
  providerReady: false,
  automation: "off" as const,
  note: "The settings screen and the fake preview are ready. There is no 9:00 scheduler, and no mail provider is called. A mock result is not a delivery.",
};

const ZONES = ["America/Toronto", "America/Vancouver", "America/Winnipeg", "America/Halifax", "America/St_Johns", "UTC"];

export function cleanBirthdayZone(value: string) {
  return ZONES.includes(value) ? value : "America/Toronto";
}

export function cleanBirthdaySource(value: string): BirthdaySettings["source"] {
  return value === "desk" || value === "dropbox" ? value : "";
}

function sameAdvisor(left: number, right: number) {
  return Number(left) === Number(right) && Number(left) > 0;
}

async function ensureRow(sql: BirthdaySql, advisorId: number) {
  const rows = await sql.query("select advisor_id from birthday_settings where advisor_id = $1", [advisorId]);
  if (rows.length) return;
  await sql.query(
    `insert into birthday_settings (advisor_id, enabled, source, timezone, feb29, card_title, template_version, confirmed_version, last_run_date, source_ref)
     values ($1, false, '', 'America/Toronto', 'skip', '', 1, 0, '', '')`,
    [advisorId],
  );
}

export async function readBirthdayDesk(sql: BirthdaySql, advisorId: number) {
  await ensureRow(sql, advisorId);
  const settings = await sql.query<Record<string, unknown>>("select * from birthday_settings where advisor_id = $1", [advisorId]);
  const row = settings[0] || {};
  const contacts = await sql.query<Record<string, unknown>>(
    "select id, full_name, email, birthday, tags from contacts where advisor_id = $1 order by full_name",
    [advisorId],
  );
  const cards = await sql.query<Record<string, unknown>>(
    "select id, title, message from saved_cards where advisor_id = $1 order by id",
    [advisorId],
  );
  const notices = await sql.query<Record<string, unknown>>(
    "select id, run_date, body, created_at from birthday_notices where advisor_id = $1 order by id desc limit 12",
    [advisorId],
  );
  const missing = contacts.filter((contact) => !String(contact.birthday || "").trim());
  const dropbox = dropboxBirthdayReady();
  return {
    ok: true as const,
    advisorId,
    enabled: false,
    storedEnabled: row.enabled === true || row.enabled === "t",
    source: cleanBirthdaySource(String(row.source || "")),
    sourceRef: String(row.source_ref || ""),
    timezone: cleanBirthdayZone(String(row.timezone || "America/Toronto")),
    feb29: row.feb29 === "march1" ? "march1" as const : "skip" as const,
    cardTitle: String(row.card_title || ""),
    templateVersion: Number(row.template_version || 1),
    confirmedVersion: Number(row.confirmed_version || 0),
    needsConfirmation: Number(row.confirmed_version || 0) !== Number(row.template_version || 1),
    cards: cards.map((card) => ({ id: Number(card.id), title: String(card.title || ""), message: String(card.message || "") })),
    missingDates: missing.map((contact) => ({ id: Number(contact.id), name: String(contact.full_name || "") })),
    notices: notices.map((notice) => ({ id: Number(notice.id), runDate: String(notice.run_date || ""), body: String(notice.body || "") })),
    dropbox,
    readiness: BIRTHDAY_READINESS,
    zones: ZONES,
  };
}

export async function saveBirthdaySettings(
  sql: BirthdaySql,
  advisorId: number,
  input: { advisorId?: number; source?: string; sourceRef?: string; timezone?: string; feb29?: string; cardTitle?: string; enabled?: boolean },
) {
  if (input.advisorId && !sameAdvisor(input.advisorId, advisorId)) {
    return { ok: false as const, error: "That birthday setup belongs to another advisor." };
  }
  if (input.enabled === true) return { ok: false as const, error: BIRTHDAY_AUTOMATION_OFF };
  await ensureRow(sql, advisorId);
  const current = await readBirthdayDesk(sql, advisorId);
  const source = input.source === undefined ? current.source : cleanBirthdaySource(input.source);
  const sourceRef = input.sourceRef === undefined ? current.sourceRef : String(input.sourceRef || "").slice(0, 300);
  const timezone = input.timezone === undefined ? current.timezone : cleanBirthdayZone(input.timezone);
  const feb29 = input.feb29 === undefined ? current.feb29 : input.feb29 === "march1" ? "march1" : "skip";
  const cardTitle = input.cardTitle === undefined ? current.cardTitle : String(input.cardTitle || "").slice(0, 500);
  const changed = source !== current.source || sourceRef !== current.sourceRef || timezone !== current.timezone || feb29 !== current.feb29 || cardTitle !== current.cardTitle;
  const version = changed ? current.templateVersion + 1 : current.templateVersion;
  await sql.query(
    `update birthday_settings
     set source = $2, source_ref = $3, timezone = $4, feb29 = $5, card_title = $6,
         template_version = $7, enabled = false, updated_at = now()
     where advisor_id = $1`,
    [advisorId, source, sourceRef, timezone, feb29, cardTitle, version],
  );
  const saved = await readBirthdayDesk(sql, advisorId);
  const { ok: _savedOk, ...desk } = saved;
  return { ok: true as const, ...desk, reconfirm: changed };
}

export async function confirmBirthdayCard(sql: BirthdaySql, advisorId: number, input: { advisorId?: number } = {}) {
  if (input.advisorId && !sameAdvisor(input.advisorId, advisorId)) {
    return { ok: false as const, error: "That birthday setup belongs to another advisor." };
  }
  const current = await readBirthdayDesk(sql, advisorId);
  if (!current.cardTitle.trim()) return { ok: false as const, error: "Choose the birthday card before confirming it." };
  if (current.source !== "desk" && current.source !== "dropbox") {
    return { ok: false as const, error: "Choose Unique Advisor contacts or one Dropbox file before confirming." };
  }
  await sql.query(
    "update birthday_settings set confirmed_version = template_version, enabled = false, updated_at = now() where advisor_id = $1",
    [advisorId],
  );
  const saved = await readBirthdayDesk(sql, advisorId);
  const { ok: _savedOk, ...desk } = saved;
  return { ok: true as const, ...desk, sent: false as const };
}

export async function pauseBirthdayCheck(sql: BirthdaySql, advisorId: number) {
  await ensureRow(sql, advisorId);
  await sql.query("update birthday_settings set enabled = false, updated_at = now() where advisor_id = $1", [advisorId]);
  const saved = await readBirthdayDesk(sql, advisorId);
  const { ok: _savedOk, ...desk } = saved;
  return { ok: true as const, ...desk, sent: false as const };
}

export function previewBirthdayDesk(input: {
  advisorId: number;
  settings: BirthdaySettings;
  people: BirthdayPerson[];
  now: Date;
  lastRunDate?: string;
}) {
  const plan = planBirthdayRun({
    advisorId: input.advisorId,
    settings: { ...input.settings, enabled: input.settings.enabled },
    people: input.people,
    claims: [],
    now: input.now,
    lastRunDate: input.lastRunDate || "",
  });
  const samples = input.people.slice(0, 3).map((person) => previewBirthdayCard(input.settings.cardTitle, person));
  return {
    ok: true as const,
    live: false as const,
    providerCalled: false as const,
    schedulerRan: false as const,
    plan,
    samples,
    notice: plan.notice,
  };
}
