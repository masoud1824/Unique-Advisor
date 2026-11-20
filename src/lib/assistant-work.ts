import { assistantGate, type AssistantSettings } from "@/lib/assistant-policy";
import { deskPeople, parseClientFile, reportFromPeople, type SourcePerson } from "@/lib/contact-records";
import { readDropboxText } from "@/lib/advisor-links";
import { SECRETARY_RULES } from "@/lib/secretary-rules";
import { ZOOM_RULE } from "@/lib/zoom-bookings";
import { getSql } from "@/lib/db";

export type ClientSource = "" | "desk" | "dropbox";

export type SavedRule = { id?: string; category?: string; text: string; on: boolean };

export type AdvisorRules = {
  birthdayCards: boolean;
  newsletterReminder: boolean;
  showBirthday?: boolean;
  showNewsletter?: boolean;
  note: string;
  rules?: SavedRule[];
  clientSource: ClientSource;
  dropboxFile: string;
};

export function ruleList(value: unknown): SavedRule[] {
  if (!Array.isArray(value)) return [];
  const list: SavedRule[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const text = item.trim().slice(0, 2000);
      if (text) list.push({ text, on: true, category: "My rules" });
    } else if (item && typeof item === "object") {
      const record = item as { id?: unknown; category?: unknown; text?: unknown; on?: unknown };
      const text = String(record.text ?? "").trim().slice(0, 2000);
      const id = String(record.id ?? "").trim().slice(0, 40);
      const category = String(record.category ?? "").trim().slice(0, 40) || "My rules";
      if (text) list.push({ ...(id ? { id } : {}), category, text, on: record.on !== false });
    }
    if (list.length >= 40) break;
  }
  return list;
}

function torontoToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function monthDay(value: string) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}-${match[3]}` : "";
}

export function fixCopyTypos(text: string) {
  return text
    .replace(/Season[`']s Greeting(?!s)/g, "Season's Greetings")
    .replace(/`s\b/g, "'s")
    .replace(/\bhowmany\b/gi, "how many")
    .replace(/\bsthe\b/g, "the")
    .replace(/\bEletters\b/g, "E-letters")
    .replace(/\beletters\b/g, "e-letters")
    .replace(/\bEletter\b/g, "E-letter")
    .replace(/\beletter\b/g, "e-letter");
}

let copyRepaired = false;

async function repairStoredCopy() {
  if (copyRepaired) return;
  copyRepaired = true;
  const sql = await getSql();
  const defaults = await sql<{ default_rules_json: string }>`select default_rules_json from operators where id = 1`;
  for (const row of defaults) {
    const next = fixCopyTypos(row.default_rules_json || "");
    if (next !== row.default_rules_json) await sql`update operators set default_rules_json = ${next} where id = 1`;
  }
  const rules = await sql<{ advisor_id: number; rules_json: string; note: string }>`select advisor_id, rules_json, note from assistant_rules`;
  for (const row of rules) {
    const rulesJson = fixCopyTypos(row.rules_json || "");
    const note = fixCopyTypos(row.note || "");
    if (rulesJson !== row.rules_json || note !== row.note) {
      await sql`update assistant_rules set rules_json = ${rulesJson}, note = ${note} where advisor_id = ${row.advisor_id}`;
    }
  }
  const templates = await sql<{ id: number; name: string; detail: string; body: string }>`select id, name, detail, body from platform_templates where kind in ('card', 'letter', 'eletter')`.catch(() => []);
  for (const row of templates) {
    const name = fixCopyTypos(row.name || "");
    const detail = fixCopyTypos(row.detail || "");
    const body = fixCopyTypos(row.body || "");
    if (name !== row.name || detail !== row.detail || body !== row.body) {
      await sql`update platform_templates set name = ${name}, detail = ${detail}, body = ${body} where id = ${row.id}`;
    }
  }
}

export async function ensureWorkTables() {
  const sql = await getSql();
  await sql.query("alter table contacts add column if not exists birthday text not null default ''");
  await sql.query(`create table if not exists assistant_rules (
    advisor_id integer primary key references advisors(id) on delete cascade,
    birthday_cards boolean not null default true,
    newsletter_reminder boolean not null default true,
    last_birthday_run text not null default '',
    last_newsletter_note text not null default '',
    note text not null default ''
  )`);
  await sql.query("alter table assistant_rules add column if not exists note text not null default ''");
  await sql.query("alter table assistant_rules add column if not exists last_review_note text not null default ''");
  await sql.query("alter table assistant_rules add column if not exists client_source text not null default ''");
  await sql.query("alter table assistant_rules add column if not exists dropbox_file text not null default ''");
  await sql.query("alter table assistant_rules add column if not exists rules_json text not null default '[]'");
  await sql.query("alter table assistant_rules add column if not exists show_birthday boolean not null default true");
  await sql.query("alter table assistant_rules add column if not exists show_newsletter boolean not null default true");
  await sql.query("alter table assistant_rules add column if not exists zoom_rule_seeded boolean not null default false");
  await sql.query("alter table assistant_rules add column if not exists secretary_seeded boolean not null default false");
  await sql.query("alter table assistant_rules add column if not exists secretary_copy_seeded boolean not null default false");
  await sql.query("alter table operators add column if not exists default_rules_json text not null default '[]'");
  await sql.query("alter table operators add column if not exists secretary_default_seeded boolean not null default false");
  await sql.query("alter table operators add column if not exists secretary_copy_seeded boolean not null default false");
  await repairStoredCopy();
}

export async function readRules(advisorId: number): Promise<AdvisorRules> {
  await ensureWorkTables();
  const row = (await (await getSql())<{ birthday_cards: boolean; newsletter_reminder: boolean; show_birthday: boolean; show_newsletter: boolean; note: string; client_source: string; dropbox_file: string; rules_json: string; zoom_rule_seeded: boolean; secretary_seeded: boolean; secretary_copy_seeded: boolean }>`
    select birthday_cards, newsletter_reminder, show_birthday, show_newsletter, note, client_source, dropbox_file, rules_json, zoom_rule_seeded, secretary_seeded, secretary_copy_seeded from assistant_rules where advisor_id = ${advisorId}
  `)[0];
  const source = row?.client_source === "dropbox" || row?.client_source === "desk" ? row.client_source : "";
  const who = (await (await getSql())<{ slug: string; advisor_name: string }>`select slug, advisor_name from advisors where id = ${advisorId}`)[0];
  const testingDesk = /masoud/i.test(`${who?.slug || ""} ${who?.advisor_name || ""}`);
  let rules: SavedRule[] = [];
  try {
    rules = ruleList(JSON.parse(row?.rules_json || "[]"));
  } catch {
    rules = [];
  }
  if (testingDesk && !row?.secretary_seeded) {
    rules = SECRETARY_RULES.map((rule) => ({ ...rule }));
    const note = rules.filter((rule) => rule.on).map((rule) => rule.text).join("\n\n").slice(0, 8000);
    if (row) {
      await (await getSql())`update assistant_rules set rules_json = ${JSON.stringify(rules)}, note = ${note}, secretary_seeded = true, secretary_copy_seeded = true, zoom_rule_seeded = true where advisor_id = ${advisorId}`;
    } else {
      await writeRules(advisorId, { birthdayCards: true, newsletterReminder: true, showBirthday: true, showNewsletter: true, note: "", rules, clientSource: "", dropboxFile: "" });
      await (await getSql())`update assistant_rules set secretary_seeded = true, secretary_copy_seeded = true, zoom_rule_seeded = true where advisor_id = ${advisorId}`;
    }
  } else if (testingDesk && row && !row.secretary_copy_seeded) {
    rules = refreshSecretaryCopy(rules);
    const note = rules.filter((rule) => rule.on).map((rule) => rule.text).join("\n\n").slice(0, 8000);
    await (await getSql())`update assistant_rules set rules_json = ${JSON.stringify(rules)}, note = ${note}, secretary_copy_seeded = true where advisor_id = ${advisorId}`;
  } else {
    if (rules.length === 0 && String(row?.note ?? "").trim()) rules = [{ text: String(row.note).trim().slice(0, 2000), on: true, category: "My rules" }];
    if (!testingDesk && !row?.zoom_rule_seeded && !rules.some((rule) => rule.text.trim().toLowerCase() === ZOOM_RULE.toLowerCase())) {
      rules = [{ text: ZOOM_RULE, on: true, category: "Meetings" }, ...rules];
    }
    if (row && !row.zoom_rule_seeded && !testingDesk) {
      await (await getSql())`update assistant_rules set rules_json = ${JSON.stringify(rules)}, zoom_rule_seeded = true, note = ${rules.filter((rule) => rule.on).map((rule) => rule.text).join("\n\n").slice(0, 8000)} where advisor_id = ${advisorId}`;
    }
  }
  if (!row) {
    await writeRules(advisorId, { birthdayCards: true, newsletterReminder: true, showBirthday: true, showNewsletter: true, note: "", rules, clientSource: "", dropboxFile: "" });
    await (await getSql())`update assistant_rules set zoom_rule_seeded = true where advisor_id = ${advisorId}`;
  }
  return {
    birthdayCards: row ? row.birthday_cards !== false : true,
    newsletterReminder: row ? row.newsletter_reminder !== false : true,
    showBirthday: row ? row.show_birthday !== false : true,
    showNewsletter: row ? row.show_newsletter !== false : true,
    rules,
    note: rules.filter((item) => item.on).map((item) => item.text).join("\n\n").slice(0, 8000),
    clientSource: source,
    dropboxFile: String(row?.dropbox_file ?? "").slice(0, 400),
  };
}

function refreshSecretaryCopy(rules: SavedRule[]) {
  const known = new Set(SECRETARY_RULES.map((rule) => rule.id));
  const custom = rules.filter((rule) => !rule.id || !known.has(String(rule.id)));
  const refreshed = SECRETARY_RULES.map((rule) => {
    const current = rules.find((item) => item.id === rule.id);
    return { ...rule, on: current ? current.on !== false : rule.on };
  });
  return [...refreshed, ...custom];
}

export async function readDefaultRules(): Promise<SavedRule[]> {
  await ensureWorkTables();
  const sql = await getSql();
  await sql.query("alter table operators add column if not exists default_rules_json text not null default '[]'");
  await sql.query("alter table operators add column if not exists zoom_default_seeded boolean not null default false");
  const row = (await sql<{ default_rules_json: string; zoom_default_seeded: boolean; secretary_default_seeded: boolean; secretary_copy_seeded: boolean }>`select default_rules_json, zoom_default_seeded, secretary_default_seeded, secretary_copy_seeded from operators where id = 1`)[0];
  if (!row?.secretary_default_seeded) {
    const list = SECRETARY_RULES.map((rule) => ({ ...rule }));
    await sql`update operators set default_rules_json = ${JSON.stringify(list)}, secretary_default_seeded = true, secretary_copy_seeded = true, zoom_default_seeded = true where id = 1`;
    return list;
  }
  let list: SavedRule[] = [];
  try {
    list = ruleList(JSON.parse(row?.default_rules_json || "[]"));
  } catch {
    list = [];
  }
  if (!row?.secretary_copy_seeded) {
    list = refreshSecretaryCopy(list);
    await sql`update operators set default_rules_json = ${JSON.stringify(list)}, secretary_copy_seeded = true where id = 1`;
  }
  if (!row?.zoom_default_seeded && !list.some((rule) => rule.text.trim().toLowerCase() === ZOOM_RULE.toLowerCase())) {
    list = [{ text: ZOOM_RULE, on: true, category: "Meetings" }, ...list];
    await sql`update operators set default_rules_json = ${JSON.stringify(list)} where id = 1`;
  }
  if (!row?.zoom_default_seeded) await sql`update operators set zoom_default_seeded = true where id = 1`;
  const previousCards = "When I ask to send an e-card, match the card and the contact, show the confirmation, and send it when I say yes. Do not send it before I confirm.";
  const nextCards = SECRETARY_RULES.find((rule) => rule.id === "cards");
  if (nextCards && list.some((rule) => rule.id === "cards" && rule.text.trim() === previousCards)) {
    list = list.map((rule) => (rule.id === "cards" && rule.text.trim() === previousCards ? { ...rule, text: nextCards.text } : rule));
    await sql`update operators set default_rules_json = ${JSON.stringify(list)} where id = 1`;
  }
  return list;
}

export async function writeDefaultRules(rules: unknown) {
  const list = ruleList(rules);
  await ensureWorkTables();
  const sql = await getSql();
  await sql.query("alter table operators add column if not exists default_rules_json text not null default '[]'");
  await sql`update operators set default_rules_json = ${JSON.stringify(list)} where id = 1`;
  return list;
}

export async function seedNewAdvisorRules(advisorId: number) {
  await ensureWorkTables();
  const sql = await getSql();
  const existing = (await sql<{ advisor_id: number }>`select advisor_id from assistant_rules where advisor_id = ${advisorId}`)[0];
  if (existing) return;
  const list = await readDefaultRules();
  if (list.length === 0) return;
  await writeRules(advisorId, {
    birthdayCards: true,
    newsletterReminder: true,
    showBirthday: true,
    showNewsletter: true,
    note: "",
    rules: list,
    clientSource: "",
    dropboxFile: "",
  });
}

export async function writeRules(advisorId: number, rules: AdvisorRules) {
  await ensureWorkTables();
  const saved = (await (await getSql())<{ birthday_cards: boolean; newsletter_reminder: boolean; show_birthday: boolean; show_newsletter: boolean; note: string; rules_json: string; client_source: string; dropbox_file: string }>`
    select birthday_cards, newsletter_reminder, show_birthday, show_newsletter, note, rules_json, client_source, dropbox_file from assistant_rules where advisor_id = ${advisorId}
  `)[0];
  const current = await (async () => {
    let kept: SavedRule[] = [];
    try {
      kept = ruleList(JSON.parse(saved?.rules_json || "[]"));
    } catch {
      kept = [];
    }
    if (kept.length === 0 && String(saved?.note ?? "").trim()) kept = [{ text: String(saved.note).trim().slice(0, 2000), on: true }];
    return kept;
  })();
  const list = Array.isArray(rules.rules) ? ruleList(rules.rules) : current;
  const note = list.filter((item) => item.on).map((item) => item.text).join("\n\n").slice(0, 8000);
  const source = rules.clientSource === "dropbox" || rules.clientSource === "desk"
    ? rules.clientSource
    : saved?.client_source === "dropbox" || saved?.client_source === "desk"
      ? saved.client_source
      : "";
  const file = String(rules.dropboxFile ?? "").trim()
    ? String(rules.dropboxFile ?? "").trim().slice(0, 400)
    : String(saved?.dropbox_file || "").slice(0, 400);
  const showBirthday = typeof rules.showBirthday === "boolean" ? rules.showBirthday : saved ? saved.show_birthday !== false : true;
  const showNewsletter = typeof rules.showNewsletter === "boolean" ? rules.showNewsletter : saved ? saved.show_newsletter !== false : true;
  const birthdayCards = showBirthday ? rules.birthdayCards : false;
  const newsletterReminder = showNewsletter ? rules.newsletterReminder : false;
  await (await getSql())`
    insert into assistant_rules (advisor_id, birthday_cards, newsletter_reminder, show_birthday, show_newsletter, note, client_source, dropbox_file, rules_json)
    values (${advisorId}, ${birthdayCards}, ${newsletterReminder}, ${showBirthday}, ${showNewsletter}, ${note}, ${source}, ${file}, ${JSON.stringify(list)})
    on conflict (advisor_id) do update
    set birthday_cards = excluded.birthday_cards,
        newsletter_reminder = excluded.newsletter_reminder,
        show_birthday = excluded.show_birthday,
        show_newsletter = excluded.show_newsletter,
        note = excluded.note,
        client_source = excluded.client_source,
        dropbox_file = excluded.dropbox_file,
        rules_json = excluded.rules_json
  `;
}

export async function loadClientBook(advisorId: number): Promise<{ source: ClientSource; file: string; error: string; people: SourcePerson[] }> {
  const { noteLookup } = await import("@/lib/lookup-log");
  noteLookup("contacts");
  const rules = await readRules(advisorId);
  if (rules.clientSource === "dropbox") {
    const file = rules.dropboxFile || "/Unique Advisor/clients.csv";
    const downloaded = await readDropboxText(advisorId, file);
    if (!downloaded.ok) return { source: "dropbox", file, error: downloaded.error, people: [] };
    const parsed = parseClientFile(downloaded.text);
    if (!parsed.ok) return { source: "dropbox", file, error: parsed.error, people: [] };
    return { source: "dropbox", file, error: "", people: parsed.people };
  }
  if (rules.clientSource === "desk") return { source: "desk", file: "", error: "", people: await deskPeople(advisorId) };
  return { source: "", file: "", error: "Choose Unique Advisor or a Dropbox file as the client database first.", people: [] };
}

export async function sourceClientReport(advisorId: number) {
  const book = await loadClientBook(advisorId);
  if (book.error) {
    return { source: book.source || "unset", file: book.file, error: book.error, needsContact: [], kycDue: [], kycDone: [], opportunities: [] };
  }
  return { source: book.source, file: book.file, error: "", ...reportFromPeople(book.people) };
}

export async function runAdvisorMorning(input: {
  advisorId: number;
  slug: string;
  code: string;
  status: string;
  plan: string;
  settings: AssistantSettings;
}) {
  const access = assistantGate({ status: input.status, plan: input.plan, settings: input.settings });
  if (!access.ok) return { ok: false as const, error: access.error, note: "" };
  await ensureWorkTables();
  const today = torontoToday();
  const sql = await getSql();
  const rulesRow = (await sql<{ birthday_cards: boolean; newsletter_reminder: boolean; show_birthday: boolean; show_newsletter: boolean; last_birthday_run: string; last_newsletter_note: string }>`
    select birthday_cards, newsletter_reminder, show_birthday, show_newsletter, last_birthday_run, last_newsletter_note
    from assistant_rules where advisor_id = ${input.advisorId}
  `)[0];
  const birthdayOn = rulesRow ? rulesRow.birthday_cards !== false && rulesRow.show_birthday !== false : true;
  const newsletterOn = rulesRow ? rulesRow.newsletter_reminder !== false && rulesRow.show_newsletter !== false : true;
  const notes: string[] = [];
  if (birthdayOn && rulesRow?.last_birthday_run !== today) {
    const due = await sql<{ id: number; full_name: string; email: string; birthday: string }>`
      select id, full_name, email, birthday from contacts
      where advisor_id = ${input.advisorId} and birthday <> ''
    `;
    const todayKey = monthDay(today);
    const people = due.filter((row) => monthDay(row.birthday) === todayKey && row.email.trim());
    let failed = "";
    const sent: string[] = [];
    if (people.length > 0) {
      const { archiveMessages } = await import("@/lib/advisor.functions");
      for (const person of people) {
        const already = (await sql<{ id: number }>`
          select id from messages
          where advisor_id = ${input.advisorId}
            and lower(contact_email) = ${person.email.trim().toLowerCase()}
            and kind = 'card'
            and title = 'Happy birthday'
            and created_at >= date_trunc('year', now())
          limit 1
        `)[0];
        if (already) continue;
        const result = await archiveMessages({
          data: {
            slug: input.slug,
            code: input.code,
            kind: "card",
            title: "Happy birthday",
            body: "Happy birthday, [Contact Name]. Wishing you a good year ahead.",
            contactIds: [Number(person.id)],
            image: "/cards/birthday.jpg",
          },
        });
        if (!result.ok) {
          failed = result.error;
          break;
        }
        sent.push(person.full_name);
      }
    }
    if (!failed) {
      await sql`
        insert into assistant_rules (advisor_id, last_birthday_run)
        values (${input.advisorId}, ${today})
        on conflict (advisor_id) do update set last_birthday_run = excluded.last_birthday_run
      `;
    }
    if (sent.length) notes.push(`Birthday cards sent through Unique Advisor to ${sent.join(", ")}.`);
    if (failed) notes.push(failed);
  }
  if (newsletterOn && rulesRow?.last_newsletter_note !== today) {
    const recent = (await sql<{ id: number }>`
      select id from messages
      where advisor_id = ${input.advisorId} and kind = 'letter' and created_at > now() - interval '30 days'
      limit 1
    `)[0];
    if (!recent) {
      notes.push("No newsletter has gone out in the last 30 days. Open Newsletters to prepare one, or ask me to draft it. I will send it only through Unique Advisor after you say to send it.");
      await sql`
        insert into assistant_rules (advisor_id, last_newsletter_note)
        values (${input.advisorId}, ${today})
        on conflict (advisor_id) do update set last_newsletter_note = excluded.last_newsletter_note
      `;
    }
  }
  const reviewed = (await sql<{ last_review_note: string }>`
    select last_review_note from assistant_rules where advisor_id = ${input.advisorId}
  `)[0];
  if (reviewed?.last_review_note !== today) {
    try {
      const report = await sourceClientReport(input.advisorId);
      const names = (rows: Array<{ name: string }>) => {
        const shown = rows.slice(0, 8).map((row) => row.name);
        return rows.length > shown.length ? `${shown.join(", ")}, and ${rows.length - shown.length} more` : shown.join(", ");
      };
      const bits: string[] = [];
      if (report.error) bits.push(report.error);
      if (report.needsContact.length) bits.push(`${report.needsContact.length} not contacted in 90 days: ${names(report.needsContact)}.`);
      if (report.kycDue.length) bits.push(`Yearly KYC is due for ${report.kycDue.length}: ${names(report.kycDue)}.`);
      if (report.opportunities.length) {
        const leads = report.opportunities.slice(0, 5).map((row) => `${row.name} (${row.ideas[0]})`).join("; ");
        bits.push(`Upsell or cross-sell to review: ${leads}.`);
      }
      if (bits.length) notes.push(bits.join(" "));
      await sql`
        insert into assistant_rules (advisor_id, last_review_note)
        values (${input.advisorId}, ${today})
        on conflict (advisor_id) do update set last_review_note = excluded.last_review_note
      `;
    } catch {
      /* the morning card and newsletter notes still stand */
    }
  }
  return { ok: true as const, note: notes.join(" ") };
}
