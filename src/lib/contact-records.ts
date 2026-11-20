import { getSql } from "@/lib/db";

export const PRODUCT_OPTIONS = [
  { id: "term", label: "Term life insurance" },
  { id: "whole", label: "Whole life" },
  { id: "ul", label: "UL insurance" },
  { id: "ci", label: "Critical illness (CI)" },
  { id: "di", label: "Disability insurance (DI)" },
  { id: "ltc", label: "Long-term care" },
  { id: "group", label: "Group benefits" },
  { id: "health", label: "Health and dental" },
  { id: "rrsp", label: "RRSP" },
  { id: "tfsa", label: "TFSA" },
  { id: "rrif", label: "RRIF" },
  { id: "resp", label: "RESP" },
  { id: "fhsa", label: "FHSA" },
  { id: "nonreg", label: "Non-registered investments" },
  { id: "seg", label: "Segregated funds" },
  { id: "annuity", label: "Annuity" },
  { id: "mortgage", label: "Mortgage or creditor insurance" },
] as const;

const PRODUCT_IDS = new Set<string>(PRODUCT_OPTIONS.map((item) => item.id));

export function productLabel(id: string) {
  return PRODUCT_OPTIONS.find((item) => item.id === id)?.label ?? id;
}

export function cleanProductIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(list.map((item) => String(item).trim().toLowerCase()).filter((id) => PRODUCT_IDS.has(id)))];
}

export async function ensureContactRecords() {
  const sql = await getSql();
  await sql.query("alter table contacts add column if not exists birthday text not null default ''");
  await sql.query("alter table contacts add column if not exists products text not null default ''");
  await sql.query("alter table contacts add column if not exists product_note text not null default ''");
  await sql.query("alter table contacts add column if not exists kyc_on text not null default ''");
  await sql.query(`create table if not exists contact_logs (
    id serial primary key,
    advisor_id integer not null,
    contact_id integer not null,
    kind text not null,
    summary text not null,
    created_at timestamptz not null default now()
  )`);
  await sql.query("create index if not exists contact_logs_advisor_idx on contact_logs (advisor_id, contact_id, created_at desc)");
}

export async function writeContactLog(advisorId: number, contactId: number, kind: string, summary: string) {
  const text = summary.trim().slice(0, 500);
  if (!text || !Number.isInteger(contactId) || contactId <= 0) return;
  await ensureContactRecords();
  await (await getSql())`
    insert into contact_logs (advisor_id, contact_id, kind, summary)
    values (${advisorId}, ${contactId}, ${kind.slice(0, 40)}, ${text})
  `;
}

function ageOf(birthday: string, now: Date) {
  const match = birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  let age = now.getFullYear() - Number(match[1]);
  const today = (now.getMonth() + 1) * 100 + now.getDate();
  const born = Number(match[2]) * 100 + Number(match[3]);
  if (today < born) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

function ideasFor(products: string[], age: number | null) {
  if (products.length === 0) return ["No products are on file. A full review is a possible conversation."];
  const has = (id: string) => products.includes(id);
  const life = has("term") || has("whole") || has("ul");
  const permanent = has("whole") || has("ul");
  const savings = has("rrsp") || has("tfsa") || has("rrif") || has("resp") || has("fhsa") || has("nonreg") || has("seg");
  const insurance = life || has("ci") || has("di") || has("ltc") || has("group") || has("health") || has("mortgage");
  const ideas: string[] = [];
  if (has("term") && !permanent) ideas.push("Holds term life only. Whole life and UL are not on file.");
  if (life && !has("ci")) ideas.push("Life coverage is on file. Critical illness is not.");
  if (insurance && !has("di")) ideas.push("Disability insurance is not on file.");
  if (insurance && !savings) ideas.push("Insurance is on file. No RRSP, TFSA, or other savings product is on file.");
  if (has("rrsp") && !has("tfsa")) ideas.push("RRSP is on file. TFSA is not.");
  if (has("rrsp") && !has("rrif") && age !== null && age >= 60) ideas.push("Age 60 or over with an RRSP. RRIF is not on file.");
  if (has("group") && !life) ideas.push("Group benefits are on file. An individual life policy is not.");
  if (age !== null && age >= 50 && !has("ltc")) ideas.push("Age 50 or over. Long-term care is not on file.");
  return ideas.slice(0, 4);
}

export type SourcePerson = {
  name: string;
  email: string;
  phone: string;
  dob: string;
  products: string[];
  productNote: string;
  kycOn: string;
  lastContact: string;
};

export function reportFromPeople(people: SourcePerson[]) {
  const now = new Date();
  const day = 86400000;
  const needsContact = [];
  const kycDue = [];
  const kycDone = [];
  const opportunities = [];
  for (const row of people) {
    const products = cleanProductIds(row.products);
    const age = ageOf(row.dob || "", now);
    const last = row.lastContact ? new Date(row.lastContact).getTime() : 0;
    const person = {
      name: row.name,
      email: row.email,
      phone: row.phone,
      dob: row.dob || "",
      age,
      products: products.map(productLabel),
      productNote: row.productNote || "",
      lastContact: last ? new Date(last).toISOString() : "",
    };
    if (!last || now.getTime() - last > 90 * day) {
      needsContact.push({ ...person, reason: last ? "No contact logged in the last 90 days." : "No contact has been logged." });
    }
    const kyc = (row.kycOn || "").trim();
    const kycTime = /^\d{4}-\d{2}-\d{2}$/.test(kyc) ? new Date(`${kyc}T00:00:00`).getTime() : 0;
    if (!kycTime || now.getTime() - kycTime > 365 * day) {
      kycDue.push({ ...person, kycOn: kyc, reason: kyc ? "KYC is older than 12 months." : "KYC date is blank." });
    } else {
      kycDone.push({ name: row.name, email: row.email, kycOn: kyc });
    }
    const ideas = ideasFor(products, age);
    if (ideas.length) opportunities.push({ ...person, ideas });
  }
  opportunities.sort((left, right) => right.ideas.length - left.ideas.length);
  return {
    asOf: now.toISOString(),
    rules: "Needs contact means no email, card, newsletter, drip, or note in the last 90 days. KYC is done only when the KYC date is within 12 months. Opportunities are gaps in the products on file. They are not a recommendation to buy.",
    needsContact: needsContact.slice(0, 60),
    kycDue: kycDue.slice(0, 60),
    kycDone: kycDone.slice(0, 40),
    opportunities: opportunities.slice(0, 60),
  };
}

export async function clientReport(advisorId: number) {
  return reportFromPeople(await deskPeople(advisorId));
}

export async function deskPeople(advisorId: number): Promise<SourcePerson[]> {
  await ensureContactRecords();
  const sql = await getSql();
  const contacts = await sql<{
    id: number;
    full_name: string;
    email: string;
    phone: string;
    birthday: string;
    products: string;
    product_note: string;
    kyc_on: string;
  }>`
    select id, full_name, email, phone, birthday, products, product_note, kyc_on
    from contacts where advisor_id = ${advisorId}
    order by full_name
    limit 200
  `;
  const logs = await sql<{ contact_id: number; last_at: string }>`
    select contact_id, max(created_at) as last_at
    from contact_logs where advisor_id = ${advisorId}
    group by contact_id
  `;
  const mail = await sql<{ email: string; last_at: string }>`
    select lower(contact_email) as email, max(created_at) as last_at
    from messages where advisor_id = ${advisorId} and contact_email <> ''
    group by lower(contact_email)
  `;
  const logAt = new Map(logs.map((row) => [Number(row.contact_id), new Date(row.last_at).getTime()]));
  const mailAt = new Map(mail.map((row) => [row.email, new Date(row.last_at).getTime()]));
  return contacts.map((row) => {
    const email = (row.email || "").toLowerCase();
    const last = Math.max(logAt.get(Number(row.id)) || 0, email ? mailAt.get(email) || 0 : 0);
    return {
      name: row.full_name,
      email: row.email,
      phone: row.phone,
      dob: row.birthday || "",
      products: cleanProductIds(row.products),
      productNote: row.product_note || "",
      kycOn: row.kyc_on || "",
      lastContact: last ? new Date(last).toISOString() : "",
    };
  });
}

function isoDate(value: string) {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!slash) return "";
  return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
}

function productsFromCell(value: string) {
  const bits = value.split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
  const ids: string[] = [];
  for (const bit of bits) {
    const lower = bit.toLowerCase();
    const found = PRODUCT_OPTIONS.find((item) => lower === item.id || lower === item.label.toLowerCase());
    if (found) ids.push(found.id);
    else ids.push(...cleanProductIds(bit));
  }
  return [...new Set(ids)];
}

function personFromRecord(record: Record<string, unknown>): SourcePerson | null {
  const text = (key: string) => String(record[key] ?? "").trim();
  const name = text("name") || text("full name") || text("client") || text("client name");
  if (name.length < 2) return null;
  const rawProducts = record.products ?? record.product ?? record.coverage ?? "";
  const productText = Array.isArray(rawProducts) ? rawProducts.map((item) => String(item)).join(";") : String(rawProducts);
  const last = isoDate(text("last contact") || text("lastcontact") || text("last contact date") || text("contacted"));
  return {
    name: name.slice(0, 80),
    email: (text("email") || text("e-mail")).slice(0, 120),
    phone: (text("phone") || text("mobile")).slice(0, 30),
    dob: isoDate(text("dob") || text("birthday") || text("birth date") || text("date of birth")),
    products: productsFromCell(productText),
    productNote: (text("product note") || text("product details") || text("notes") || text("note")).slice(0, 500),
    kycOn: isoDate(text("kyc") || text("kyc date") || text("kyc on")),
    lastContact: last ? `${last}T00:00:00.000Z` : "",
  };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < src.length; index += 1) {
    const char = src[index];
    if (quotes) {
      if (char === "\"") {
        if (src[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else quotes = false;
      } else cell += char;
    } else if (char === "\"") quotes = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && src[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

export function parseClientFile(text: string): { ok: true; people: SourcePerson[] } | { ok: false; error: string } {
  const raw = text.trim();
  if (!raw) return { ok: false, error: "That Dropbox file is empty." };
  let records: Record<string, unknown>[] = [];
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      records = list.filter((item) => item && typeof item === "object").map((item) => {
        const record: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(item as Record<string, unknown>)) record[key.toLowerCase()] = value;
        return record;
      });
    } catch {
      return { ok: false, error: "That Dropbox file is not valid JSON." };
    }
  } else {
    const table = parseCsv(raw);
    if (table.length < 2) return { ok: false, error: "The CSV needs a header row and at least one client." };
    const headers = table[0].map((item) => item.trim().toLowerCase());
    records = table.slice(1).map((line) => {
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        record[header] = line[index] ?? "";
      });
      return record;
    });
  }
  const people = records.map(personFromRecord).filter((item): item is SourcePerson => Boolean(item)).slice(0, 200);
  if (people.length === 0) return { ok: false, error: "No clients were found. Use columns name, email, phone, dob, kyc, products, and last contact." };
  return { ok: true, people };
}

export async function contactHistory(advisorId: number, contactId: number) {
  await ensureContactRecords();
  const sql = await getSql();
  const contact = (await sql<{ email: string }>`select email from contacts where id = ${contactId} and advisor_id = ${advisorId}`)[0];
  if (!contact) return [];
  const logs = await sql<{ id: number; kind: string; summary: string; created_at: string }>`
    select id, kind, summary, created_at from contact_logs
    where advisor_id = ${advisorId} and contact_id = ${contactId}
    order by created_at desc limit 80
  `;
  const email = contact.email.trim().toLowerCase();
  const mail = email
    ? await sql<{ id: number; kind: string; title: string; created_at: string }>`
        select id, kind, title, created_at from messages
        where advisor_id = ${advisorId} and lower(contact_email) = ${email}
        order by created_at desc limit 40
      `
    : [];
  const rows = [
    ...logs.map((row) => ({ id: `log-${row.id}`, kind: row.kind, summary: row.summary, createdAt: new Date(row.created_at).toISOString() })),
    ...mail.map((row) => ({ id: `mail-${row.id}`, kind: row.kind, summary: row.title, createdAt: new Date(row.created_at).toISOString() })),
  ];
  rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.kind}|${row.summary}|${row.createdAt.slice(0, 16)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
}
