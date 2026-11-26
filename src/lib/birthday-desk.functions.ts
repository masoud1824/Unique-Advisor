import { createServerFn } from "@tanstack/react-start";
import { gateAdvisor } from "@/lib/advisor-db";
import { getSql } from "@/lib/db";
import { todaysBirthdayReport, zonedParts, type BirthdayPerson } from "@/lib/birthday-job";
import {
  confirmBirthdayCard,
  pauseBirthdayCheck,
  previewBirthdayDesk,
  readBirthdayDesk,
  saveBirthdaySettings,
} from "@/lib/birthday-desk";

type Sql = Awaited<ReturnType<typeof getSql>>;

function asBirthdaySql(sql: Sql) {
  return {
    query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => sql.query<T>(text, params),
  };
}

export const loadBirthdayDesk = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  return readBirthdayDesk(asBirthdaySql(await getSql()), Number(gate.row.id));
});

export const saveBirthdayDesk = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string; advisorId?: number; source?: string; sourceRef?: string; timezone?: string; feb29?: string; cardTitle?: string; enabled?: boolean };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  if (body.advisorId && Number(body.advisorId) !== Number(gate.row.id)) {
    return { ok: false as const, error: "That birthday setup belongs to another advisor." };
  }
  return saveBirthdaySettings(asBirthdaySql(await getSql()), Number(gate.row.id), body);
});

export const confirmBirthdayDesk = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string; advisorId?: number };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  if (body.advisorId && Number(body.advisorId) !== Number(gate.row.id)) {
    return { ok: false as const, error: "That birthday setup belongs to another advisor." };
  }
  return confirmBirthdayCard(asBirthdaySql(await getSql()), Number(gate.row.id), body);
});

export const pauseBirthdayDesk = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  return pauseBirthdayCheck(asBirthdaySql(await getSql()), Number(gate.row.id));
});

export const previewBirthdayDeskPlan = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string; now?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  const desk = await readBirthdayDesk(asBirthdaySql(await getSql()), Number(gate.row.id));
  const now = body.now ? new Date(body.now) : new Date();
  const local = zonedParts(now, desk.timezone);
  const people: BirthdayPerson[] = [];
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(
    "select id, full_name, email, birthday, tags from contacts where advisor_id = $1 order by id",
    [gate.row.id],
  );
  for (const row of rows) {
    const tags = String(row.tags || "");
    people.push({
      contactId: String(row.id),
      name: String(row.full_name || ""),
      email: String(row.email || ""),
      birthday: String(row.birthday || ""),
      unsubscribed: /unsubscribed/i.test(tags),
    });
  }
  const preview = previewBirthdayDesk({
    advisorId: Number(gate.row.id),
    settings: {
      enabled: false,
      source: desk.source,
      timezone: desk.timezone,
      feb29: desk.feb29,
      templateVersion: desk.templateVersion,
      confirmedVersion: desk.confirmedVersion,
      cardTitle: desk.cardTitle,
    },
    people,
    now,
  });
  const pretended = previewBirthdayDesk({
    advisorId: Number(gate.row.id),
    settings: {
      enabled: true,
      source: desk.source,
      timezone: desk.timezone,
      feb29: desk.feb29,
      templateVersion: desk.templateVersion,
      confirmedVersion: desk.templateVersion,
      cardTitle: desk.cardTitle || "Happy birthday, {{name}}.",
    },
    people,
    now: new Date(`${local.date}T14:00:00.000Z`),
  });
  return {
    ok: true as const,
    live: false as const,
    providerCalled: false as const,
    schedulerRan: false as const,
    savedStaysOff: desk.enabled === false,
    localDate: local.date,
    offNotice: preview.notice,
    pretendNotice: pretended.notice,
    samples: pretended.samples,
    missing: desk.missingDates,
  };
});

export const loadTodaysBirthdays = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string; now?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  const now = body.now ? new Date(body.now) : new Date();
  if (Number.isNaN(now.getTime())) return { ok: false as const, error: "That date could not be read." };
  const sql = await getSql();
  const advisorId = Number(gate.row.id);
  let timeZone = "America/Toronto";
  let feb29: "skip" | "march1" = "skip";
  try {
    const settings = await sql.query<Record<string, unknown>>("select timezone, feb29 from birthday_settings where advisor_id = $1 limit 1", [advisorId]);
    if (settings[0]?.timezone) timeZone = String(settings[0].timezone);
    if (settings[0]?.feb29 === "march1") feb29 = "march1";
  } catch {
    /* settings are optional; the desk zone below is used */
  }
  const rows = await sql.query<Record<string, unknown>>("select id, full_name, email, birthday, tags from contacts where advisor_id = $1 order by full_name", [advisorId]);
  const people: BirthdayPerson[] = rows.map((row) => ({
    contactId: String(row.id),
    name: String(row.full_name || ""),
    email: String(row.email || ""),
    birthday: String(row.birthday || ""),
    unsubscribed: /unsubscribed/i.test(String(row.tags || "")),
  }));
  let claims: Array<{ key: string; status: string }> = [];
  let records: "read" | "unavailable" = "read";
  try {
    const stored = await sql.query<Record<string, unknown>>("select claim_key, status from birthday_claims where advisor_id = $1", [advisorId]);
    claims = stored.map((row) => ({ key: String(row.claim_key || ""), status: String(row.status || "") }));
  } catch {
    records = "unavailable";
  }
  const report = todaysBirthdayReport({ advisorId, people, claims: records === "read" ? claims : [], now, timeZone, feb29 });
  return {
    ok: true as const,
    date: report.date,
    timeZone: report.timeZone,
    records,
    people: report.people.map((person) => ({ ...person, card: records === "read" ? person.card : "unavailable" as const })),
  };
});
