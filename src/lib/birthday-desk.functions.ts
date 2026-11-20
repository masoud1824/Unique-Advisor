import { createServerFn } from "@tanstack/react-start";
import { gateAdvisor } from "@/lib/advisor-db";
import { getSql } from "@/lib/db";
import { zonedParts, type BirthdayPerson } from "@/lib/birthday-job";
import {
  BIRTHDAY_AUTOMATION_OFF,
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
  if (body.enabled === true) return { ok: false as const, error: BIRTHDAY_AUTOMATION_OFF };
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
    savedStaysOff: true as const,
    localDate: local.date,
    offNotice: preview.notice,
    pretendNotice: pretended.notice,
    samples: pretended.samples,
    missing: desk.missingDates,
  };
});
