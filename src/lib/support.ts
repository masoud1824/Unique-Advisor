import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";
import { accessTokenForAdvisor, graphSendMail } from "@/lib/microsoft-mail";

export const TICKET_STATUSES = ["Open", "In progress", "Waiting on advisor", "Resolved", "Closed"] as const;
export const TICKET_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export const TICKET_CATEGORIES = ["Bug", "Billing", "Account", "Feature request", "Other"] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export type SupportFile = { name: string; mime: string; data: string };

type TicketRow = {
  id: number;
  number: string;
  advisor_id: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assignee: string;
  created_at: string;
  updated_at: string;
  advisor_name?: string;
  advisor_email?: string;
};

export async function ensureSupportTables() {
  const sql = await getSql();
  await sql.query(`create table if not exists support_tickets (
    id serial primary key,
    number text not null default '',
    advisor_id integer not null,
    subject text not null default '',
    category text not null default 'Other',
    priority text not null default 'Normal',
    status text not null default 'Open',
    assignee text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists support_messages (
    id serial primary key,
    ticket_id integer not null,
    author text not null default 'advisor',
    body text not null default '',
    created_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists support_files (
    id serial primary key,
    ticket_id integer not null,
    message_id integer not null default 0,
    name text not null default '',
    mime text not null default '',
    data text not null default ''
  )`);
  await sql.query("alter table operators add column if not exists support_email text not null default ''");
  await sql.query("alter table operators add column if not exists support_webhook text not null default ''");
  await sql.query("alter table operators add column if not exists support_webhook_secret text not null default ''");
  await sql.query("alter table operators add column if not exists support_api_hash text not null default ''");
}

function asStatus(value: string): TicketStatus {
  return TICKET_STATUSES.includes(value as TicketStatus) ? (value as TicketStatus) : "Open";
}
function asPriority(value: string): TicketPriority {
  return TICKET_PRIORITIES.includes(value as TicketPriority) ? (value as TicketPriority) : "Normal";
}
function asCategory(value: string): TicketCategory {
  return TICKET_CATEGORIES.includes(value as TicketCategory) ? (value as TicketCategory) : "Other";
}

export function cleanFiles(files: unknown): SupportFile[] {
  if (!Array.isArray(files)) return [];
  const kept: SupportFile[] = [];
  for (const item of files) {
    const file = item as { name?: string; mime?: string; data?: string };
    const data = String(file?.data ?? "");
    const mime = String(file?.mime ?? "").slice(0, 80);
    if (!/^data:(image\/(?:png|jpeg|jpg|webp|gif)|application\/pdf|text\/plain);base64,[A-Za-z0-9+/=\s]+$/.test(data)) continue;
    if (data.length > 1_800_000) continue;
    kept.push({ name: String(file?.name ?? "file").replace(/[^\w.\- ]+/g, "").slice(0, 80) || "file", mime, data });
    if (kept.length >= 4) break;
  }
  return kept;
}

async function settingsRow() {
  await ensureSupportTables();
  return (await (await getSql())<{ support_email: string; support_webhook: string; support_webhook_secret: string; support_api_hash: string }>`
    select support_email, support_webhook, support_webhook_secret, support_api_hash from operators where id = 1
  `)[0];
}

export async function readSupportSettings() {
  const row = await settingsRow();
  return {
    email: String(row?.support_email ?? ""),
    webhook: String(row?.support_webhook ?? ""),
    webhookSecret: String(row?.support_webhook_secret ?? ""),
    hasApiKey: Boolean(row?.support_api_hash),
  };
}

export async function writeSupportSettings(input: { email?: string; webhook?: string; webhookSecret?: string }) {
  await ensureSupportTables();
  const current = await readSupportSettings();
  const email = input.email === undefined ? current.email : String(input.email).trim().slice(0, 160);
  const webhook = input.webhook === undefined ? current.webhook : String(input.webhook).trim().slice(0, 400);
  const webhookSecret = input.webhookSecret === undefined ? current.webhookSecret : String(input.webhookSecret).trim().slice(0, 200);
  await (await getSql())`
    update operators set support_email = ${email}, support_webhook = ${webhook}, support_webhook_secret = ${webhookSecret} where id = 1
  `;
  return readSupportSettings();
}

export async function issueSupportApiKey() {
  await ensureSupportTables();
  const key = `ua_${randomBytes(24).toString("base64url")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  await (await getSql())`update operators set support_api_hash = ${hash} where id = 1`;
  return key;
}

export async function supportKeyMatches(header: string) {
  const presented = header.replace(/^Bearer\s+/i, "").trim();
  if (!presented) return false;
  const row = await settingsRow();
  const stored = String(row?.support_api_hash ?? "");
  if (!stored) return false;
  const hash = createHash("sha256").update(presented).digest("hex");
  const left = Buffer.from(hash);
  const right = Buffer.from(stored);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function advisorOf(id: number) {
  return (await (await getSql())<{ advisor_name: string; email: string; practice_name: string }>`
    select advisor_name, email, practice_name from advisors where id = ${id}
  `)[0];
}

function ticketNumber(id: number) {
  return `UA-${String(id).padStart(4, "0")}`;
}

async function saveFiles(ticketId: number, messageId: number, files: SupportFile[]) {
  const sql = await getSql();
  for (const file of files) {
    await sql`
      insert into support_files (ticket_id, message_id, name, mime, data)
      values (${ticketId}, ${messageId}, ${file.name}, ${file.mime}, ${file.data})
    `;
  }
}

async function sendPlain(to: string, subject: string, text: string, advisorId: number) {
  const address = to.trim();
  if (!address.includes("@")) return;
  const host = process.env.SUPPORT_SMTP_HOST?.trim() || "";
  const user = process.env.SUPPORT_SMTP_USER?.trim() || "";
  const pass = process.env.SUPPORT_SMTP_PASS?.trim() || "";
  const from = (await settingsRow())?.support_email || user;
  if (host && user && pass && from) {
    const nodemailer = (await import("nodemailer")).default;
    const port = Number(process.env.SUPPORT_SMTP_PORT || 587);
    await nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }).sendMail({
      from,
      to: address,
      subject,
      text,
    });
    return;
  }
  const row = (await (await getSql())<{ mail_from: string; mail_name: string; mail_host: string; mail_port: number; mail_pass: string; mail_provider: string; ms_refresh: string }>`
    select mail_from, mail_name, mail_host, mail_port, mail_pass, mail_provider, ms_refresh from advisors where id = ${advisorId}
  `)[0];
  if (!row) return;
  if (row.mail_provider === "microsoft" || row.ms_refresh) {
    const token = await accessTokenForAdvisor(advisorId);
    await graphSendMail({ accessToken: token, to: address, subject, html: `<p>${text.replace(/&/g, "&").replace(/</g, "<").replace(/\n/g, "<br>")}</p>` });
    return;
  }
  if (!row.mail_from || !row.mail_pass || !row.mail_host) return;
  const nodemailer = (await import("nodemailer")).default;
  const port = row.mail_port === 465 ? 465 : 587;
  await nodemailer.createTransport({ host: row.mail_host, port, secure: port === 465, auth: { user: row.mail_from, pass: row.mail_pass } }).sendMail({
    from: row.mail_name ? `"${row.mail_name.replace(/"/g, "")}" <${row.mail_from}>` : row.mail_from,
    to: address,
    subject,
    text,
  });
}

async function notify(ticket: TicketRow, latest: string, kind: "created" | "advisor" | "reply" | "status") {
  const advisor = await advisorOf(ticket.advisor_id);
  const settings = await readSupportSettings();
  const link = `https://youradviser.grok.me/admin?ticket=${encodeURIComponent(ticket.number)}`;
  const payload = {
    ticketNumber: ticket.number,
    id: Number(ticket.id),
    advisorName: advisor?.advisor_name || advisor?.practice_name || "",
    advisorEmail: advisor?.email || "",
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    latestMessage: latest.slice(0, 2000),
    link,
  };
  if (settings.webhook) {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.webhookSecret) headers["X-Unique-Advisor-Signature"] = createHmac("sha256", settings.webhookSecret).update(body).digest("hex");
    await fetch(settings.webhook, { method: "POST", headers, body }).catch(() => undefined);
  }
  const subject = `${ticket.number}: ${ticket.subject}`;
  try {
    if ((kind === "created" || kind === "advisor") && settings.email) {
      await sendPlain(settings.email, subject, `${payload.advisorName} (${payload.advisorEmail})\n\n${latest}\n\n${link}`, ticket.advisor_id);
    }
    if ((kind === "reply" || kind === "status") && advisor?.email) {
      await sendPlain(advisor.email, subject, `${latest}\n\nStatus: ${ticket.status}\n\nOpen Support in your Unique Advisor desk to reply.`, ticket.advisor_id);
    }
  } catch {
    /* the ticket is already saved if mail cannot leave */
  }
}

async function loadTicket(id: number) {
  return (await (await getSql())<TicketRow>`
    select t.*, a.advisor_name, a.email as advisor_email
    from support_tickets t
    left join advisors a on a.id = t.advisor_id
    where t.id = ${id}
  `)[0];
}

export async function createTicket(advisorId: number, input: { subject: string; category: string; priority: string; description: string; files: SupportFile[] }) {
  await ensureSupportTables();
  const subject = input.subject.trim().slice(0, 160);
  const description = input.description.trim().slice(0, 8000);
  if (subject.length < 3 || description.length < 3) return { ok: false as const, error: "Add a subject and a description." };
  const sql = await getSql();
  const row = (await sql<{ id: number }>`
    insert into support_tickets (advisor_id, subject, category, priority, status)
    values (${advisorId}, ${subject}, ${asCategory(input.category)}, ${asPriority(input.priority)}, ${"Open"})
    returning id
  `)[0];
  const number = ticketNumber(Number(row.id));
  await sql`update support_tickets set number = ${number} where id = ${row.id}`;
  const message = (await sql<{ id: number }>`
    insert into support_messages (ticket_id, author, body) values (${row.id}, ${"advisor"}, ${description}) returning id
  `)[0];
  await saveFiles(Number(row.id), Number(message.id), input.files);
  const ticket = await loadTicket(Number(row.id));
  if (ticket) await notify(ticket, description, "created");
  return { ok: true as const, ticket: publicTicket(ticket!) };
}

export async function advisorReply(advisorId: number, ticketId: number, body: string, files: SupportFile[]) {
  await ensureSupportTables();
  const text = body.trim().slice(0, 8000);
  if (text.length < 1 && files.length === 0) return { ok: false as const, error: "Write a reply first." };
  const ticket = await loadTicket(ticketId);
  if (!ticket || Number(ticket.advisor_id) !== advisorId) return { ok: false as const, error: "That ticket was not found." };
  const sql = await getSql();
  const message = (await sql<{ id: number }>`
    insert into support_messages (ticket_id, author, body) values (${ticketId}, ${"advisor"}, ${text || "Attachment"}) returning id
  `)[0];
  await saveFiles(ticketId, Number(message.id), files);
  await sql`update support_tickets set updated_at = now(), status = ${ticket.status === "Waiting on advisor" ? "Open" : ticket.status} where id = ${ticketId}`;
  const next = await loadTicket(ticketId);
  if (next) await notify(next, text || "Attachment", "advisor");
  return { ok: true as const };
}

export async function listAdvisorTickets(advisorId: number) {
  await ensureSupportTables();
  const rows = await (await getSql())<TicketRow>`
    select * from support_tickets where advisor_id = ${advisorId} order by updated_at desc limit 100
  `;
  return rows.map(publicTicket);
}

function publicTicket(row: TicketRow) {
  return {
    id: Number(row.id),
    number: row.number,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    assignee: row.assignee,
    updatedAt: new Date(row.updated_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    advisorName: row.advisor_name || "",
    advisorEmail: row.advisor_email || "",
  };
}

async function messagesFor(ticketId: number, includeNotes: boolean) {
  const rows = await (await getSql())<{ id: number; author: string; body: string; created_at: string }>`
    select id, author, body, created_at from support_messages where ticket_id = ${ticketId} order by id
  `;
  const files = await (await getSql())<{ id: number; message_id: number; name: string }>`
    select id, message_id, name from support_files where ticket_id = ${ticketId} order by id
  `;
  return rows
    .filter((row) => includeNotes || row.author !== "note")
    .map((row) => ({
      id: Number(row.id),
      author: row.author,
      body: row.body,
      at: new Date(row.created_at).toISOString(),
      files: files.filter((file) => Number(file.message_id) === Number(row.id)).map((file) => ({ id: Number(file.id), name: file.name })),
    }));
}

export async function readAdvisorTicket(advisorId: number, ticketId: number) {
  const ticket = await loadTicket(ticketId);
  if (!ticket || Number(ticket.advisor_id) !== advisorId) return { ok: false as const, error: "That ticket was not found." };
  return { ok: true as const, ticket: publicTicket(ticket), messages: await messagesFor(ticketId, false) };
}

export async function readSupportFile(ticketId: number, fileId: number, advisorId?: number) {
  await ensureSupportTables();
  const ticket = await loadTicket(ticketId);
  if (!ticket) return null;
  if (advisorId && Number(ticket.advisor_id) !== advisorId) return null;
  const file = (await (await getSql())<{ name: string; mime: string; data: string }>`
    select name, mime, data from support_files where id = ${fileId} and ticket_id = ${ticketId}
  `)[0];
  return file ?? null;
}

export async function openTicketCount() {
  await ensureSupportTables();
  const row = (await (await getSql())<{ total: number }>`
    select count(*)::int as total from support_tickets where status in ('Open', 'In progress', 'Waiting on advisor')
  `)[0];
  return Number(row?.total ?? 0);
}

export async function listAllTickets(filter: { status?: string; priority?: string; category?: string; advisor?: string; search?: string }) {
  await ensureSupportTables();
  const rows = await (await getSql())<TicketRow>`
    select t.*, a.advisor_name, a.email as advisor_email
    from support_tickets t
    left join advisors a on a.id = t.advisor_id
    order by t.updated_at desc
    limit 300
  `;
  const status = String(filter.status ?? "");
  const priority = String(filter.priority ?? "");
  const category = String(filter.category ?? "");
  const advisor = String(filter.advisor ?? "").trim().toLowerCase();
  const search = String(filter.search ?? "").trim().toLowerCase();
  return rows
    .filter((row) => !status || row.status === status)
    .filter((row) => !priority || row.priority === priority)
    .filter((row) => !category || row.category === category)
    .filter((row) => !advisor || String(row.advisor_name || "").toLowerCase().includes(advisor) || String(row.advisor_email || "").toLowerCase().includes(advisor))
    .filter((row) => !search || `${row.number} ${row.subject} ${row.advisor_name || ""} ${row.advisor_email || ""}`.toLowerCase().includes(search))
    .map(publicTicket);
}

export async function readAnyTicket(ticketId: number) {
  const ticket = await loadTicket(ticketId);
  if (!ticket) return { ok: false as const, error: "That ticket was not found." };
  return { ok: true as const, ticket: publicTicket(ticket), messages: await messagesFor(ticketId, true) };
}

export async function findTicketByNumber(number: string) {
  await ensureSupportTables();
  const row = (await (await getSql())<{ id: number }>`select id from support_tickets where number = ${number} limit 1`)[0];
  return row ? Number(row.id) : 0;
}

export async function staffReply(ticketId: number, body: string) {
  const text = body.trim().slice(0, 8000);
  if (text.length < 1) return { ok: false as const, error: "Write a reply first." };
  const ticket = await loadTicket(ticketId);
  if (!ticket) return { ok: false as const, error: "That ticket was not found." };
  await (await getSql())`insert into support_messages (ticket_id, author, body) values (${ticketId}, ${"admin"}, ${text})`;
  await (await getSql())`update support_tickets set updated_at = now() where id = ${ticketId}`;
  const next = await loadTicket(ticketId);
  if (next) await notify(next, text, "reply");
  return { ok: true as const };
}

export async function staffNote(ticketId: number, body: string) {
  const text = body.trim().slice(0, 8000);
  if (text.length < 1) return { ok: false as const, error: "Write the note first." };
  const ticket = await loadTicket(ticketId);
  if (!ticket) return { ok: false as const, error: "That ticket was not found." };
  await (await getSql())`insert into support_messages (ticket_id, author, body) values (${ticketId}, ${"note"}, ${text})`;
  return { ok: true as const };
}

export async function staffUpdate(ticketId: number, input: { status?: string; priority?: string; assignee?: string }) {
  const ticket = await loadTicket(ticketId);
  if (!ticket) return { ok: false as const, error: "That ticket was not found." };
  const status = input.status ? asStatus(input.status) : asStatus(ticket.status);
  const priority = input.priority ? asPriority(input.priority) : asPriority(ticket.priority);
  const assignee = input.assignee === undefined ? ticket.assignee : String(input.assignee).trim().slice(0, 80);
  const changed = status !== ticket.status;
  await (await getSql())`update support_tickets set status = ${status}, priority = ${priority}, assignee = ${assignee}, updated_at = now() where id = ${ticketId}`;
  const next = await loadTicket(ticketId);
  if (next && changed) await notify(next, `Status changed to ${status}.`, "status");
  return { ok: true as const, ticket: next ? publicTicket(next) : undefined };
}
