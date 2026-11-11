import { getSql, dbSource, type Sql } from "@/lib/db";
import { codesMatch, hashCode } from "@/lib/codes";
import { clearDeskSession, readDeskSession, slideDeskSession, startDeskSession } from "@/lib/desk-session";
import { sessionStillValid } from "@/lib/desk-session-check";
import { privateOperatorPassword } from "@/lib/operator-password";
import {
  applyPackage,
  PACKAGES,
  PALETTES,
  PLANS,
  type AdvisorStatus,
  type PackageId,
  type Palette,
  type PlanId,
  type PublicSite,
  type SiteSettings,
} from "@/lib/site-types";

export const OPERATOR_CODE = "superadmin";

export { isBuiltinAdvisorSite, shownWebsite, useCurrentWebsite } from "@/lib/advisor-website";

const RESERVED = new Set([
  "admin",
  "signup",
  "login",
  "studio",
  "a",
  "api",
  "assets",
  "photos",
  "sample",
  "guide",
  "s",
  "auth",
  "www",
  "admin",
  "mail",
  "app",
]);

export type AdvisorRow = {
  id: number;
  slug: string;
  practice_name: string;
  advisor_name: string;
  email: string;
  plan: string;
  status: string;
  package: string;
  palette: string;
  show_life: boolean;
  show_critical: boolean;
  show_disability: boolean;
  show_group: boolean;
  show_facts: boolean;
  show_form: boolean;
  code_hash: string | null;
  code_is_default: boolean;
  site_mode: string;
  site_url: string;
  public_name: string;
  public_title: string;
  public_photo: string;
  public_phone: string;
  public_card_email: string;
  public_company: string;
  public_website: string;
  public_social: string;
  site_content: string;
  created_at?: string | Date;
};

const COLUMNS = `id, slug, practice_name, advisor_name, email, plan, status, package, palette,
  show_life, show_critical, show_disability, show_group, show_facts, show_form,
  code_hash, code_is_default, site_mode, site_url, public_name, public_title, public_photo,
  public_phone, public_card_email, public_company, public_website, public_social, site_content, created_at`;

function asPlan(value: string): PlanId {
  return PLANS.includes(value as PlanId) ? (value as PlanId) : "starter";
}

function asPackage(value: string): PackageId {
  return PACKAGES.includes(value as PackageId) ? (value as PackageId) : "explain";
}

function asStatus(value: string): AdvisorStatus {
  return value === "suspended" ? "suspended" : "active";
}

export function toPublic(row: AdvisorRow): PublicSite {
  const palette = PALETTES.includes(row.palette as Palette) ? (row.palette as Palette) : "ink";
  const settings: SiteSettings = {
    packageId: asPackage(row.package),
    palette,
    showLife: Boolean(row.show_life),
    showCritical: Boolean(row.show_critical),
    showDisability: Boolean(row.show_disability),
    showGroup: Boolean(row.show_group),
    showFacts: Boolean(row.show_facts),
    showForm: Boolean(row.show_form),
    codeIsDefault: Boolean(row.code_is_default),
  };
  return {
    ...applyPackage(settings),
    slug: row.slug,
    practiceName: row.practice_name,
    advisorName: row.advisor_name,
    plan: asPlan(row.plan),
    status: asStatus(row.status),
    siteMode: row.site_mode === "own" ? "own" : "builtin",
    siteUrl: row.site_url ?? "",
    publicName: row.public_name ?? "",
    publicTitle: row.public_title ?? "",
    publicPhoto: row.public_photo ?? "",
    publicPhone: row.public_phone ?? "",
    publicCardEmail: row.public_card_email ?? "",
    publicCompany: row.public_company ?? "",
    publicWebsite: row.public_website ?? "",
    publicSocial: row.public_social ?? "",
    siteContent: row.site_content ?? "",
  };
}

const globalRef = globalThis as typeof globalThis & { __advisorReady?: Promise<void> };

export function ready() {
  globalRef.__advisorReady ??= (async () => {
    const sql = await getSql();
    const existing = await sql<{ code_hash: string | null }>`
      select code_hash from operators where id = 1
    `;
    if (!existing[0]) {
      await sql`
        insert into operators (id, code_hash, code_is_default)
        values (1, ${hashCode(OPERATOR_CODE)}, true)
      `;
    } else if (!existing[0].code_hash) {
      await sql`
        update operators
        set code_hash = ${hashCode(OPERATOR_CODE)}, code_is_default = true
        where id = 1
      `;
    }
  })().catch((err) => {
    globalRef.__advisorReady = undefined;
    throw err;
  });
  return globalRef.__advisorReady;
}

export async function findAdvisorBySlug(slug: string) {
  await ready();
  const sql = await getSql();
  const found = await sql.query<AdvisorRow>(
    `select ${COLUMNS} from advisors where slug = $1 limit 1`,
    [slug],
  );
  return found[0] ?? null;
}

export async function findAdvisorByEmail(email: string) {
  await ready();
  const sql = await getSql();
  const found = await sql.query<AdvisorRow>(
    `select ${COLUMNS} from advisors where lower(email) = $1 limit 1`,
    [email],
  );
  return found[0] ?? null;
}

export function cleanSlug(slug: string) {
  const value = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 40) return null;
  return value;
}

export function slugBase(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function nameSlug(first: string, last: string) {
  const a = slugBase(first);
  const b = slugBase(last);
  if (a.length < 2 || b.length < 2) return null;
  return `${a}-${b}`.replace(/-+/g, "-").slice(0, 40);
}

export function cleanDomain(raw: string) {
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!value) return "";
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value)) return null;
  if (value.includes("*")) return null;
  return value;
}

export async function baseDomain() {
  await ready();
  const sql = await getSql();
  const rows = await sql<{ base_domain: string }>`select base_domain from operators where id = 1`;
  return (rows[0]?.base_domain ?? "").trim().toLowerCase();
}

export async function allocateSlug(sql: Sql, name: string) {
  const base = slugBase(name);
  if (base.length < 3) return null;
  let candidate = base;
  if (RESERVED.has(candidate)) candidate = `${base}-office`.slice(0, 32);
  for (let n = 0; n < 40; n += 1) {
    const slug = n === 0 ? candidate : `${candidate}-${n + 1}`;
    if (RESERVED.has(slug) || slug.length > 40) continue;
    const rows = await sql.query<{ id: number }>("select id from advisors where slug = $1 limit 1", [
      slug,
    ]);
    if (!rows[0]) return slug;
  }
  return null;
}

export async function gateAdvisor(
  slug: string,
  code: string,
): Promise<{ ok: true; row: AdvisorRow; site: PublicSite; sessionToken: string } | { ok: false; error: string }> {
  const clean = cleanSlug(slug);
  if (!clean) return { ok: false, error: "That practice is not on this host." };
  const row = await findAdvisorBySlug(clean);
  if (!row?.code_hash) return { ok: false, error: "That access code is not right." };
  if (row.status === "suspended") return { ok: false, error: "This service is paused." };
  if (codesMatch(row.code_hash, code ?? "")) {
    const current = await readDeskSession(clean).catch(() => null);
    let sessionToken = "";
    if (current && sessionStillValid(current, row)) {
      await slideDeskSession(clean).catch(() => undefined);
      sessionToken = current.token;
    } else {
      sessionToken = (await startDeskSession(row).catch(() => "")) || "";
    }
    return { ok: true, row, site: toPublic(row), sessionToken };
  }
  const session = await readDeskSession(clean).catch(() => null);
  if (session && sessionStillValid(session, row)) {
    await slideDeskSession(clean).catch(() => undefined);
    return { ok: true, row, site: toPublic(row), sessionToken: session.token };
  }
  return { ok: false, error: "That access code is not right." };
}

export async function gateOperator(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await ready();
  await enforcePreviewOperator();
  if (dbSource === "pglite" && String(code || "").trim().toLowerCase() === "superadmin") {
    return { ok: false, error: "That access code is not right." };
  }
  const sql = await getSql();
  const rows = await sql<{ code_hash: string | null; code_is_default: boolean }>`
    select code_hash, code_is_default from operators where id = 1
  `;
  const row = rows[0];
  const previewDefault = dbSource === "pglite" && (row?.code_is_default === true || row?.code_is_default === "t" || row?.code_is_default === "true" || row?.code_is_default === 1 || row?.code_is_default === "1");
  if (previewDefault) return { ok: false, error: "Set a private Superadmin password in this preview first." };
  const hash = row?.code_hash;
  if (!hash || !codesMatch(hash, code ?? "")) {
    return { ok: false, error: "That access code is not right." };
  }
  return { ok: true };
}

export async function operatorIsDefault() {
  await ready();
  const sql = await getSql();
  const rows = await sql<{ code_is_default: boolean }>`
    select code_is_default from operators where id = 1
  `;
  const value = rows[0]?.code_is_default;
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

export async function enforcePreviewOperator() {
  if (dbSource !== "pglite") return;
  const sql = await getSql();
  const secret = String(process.env.PREVIEW_OPERATOR_PASSWORD || "").trim();
  if (!privateOperatorPassword(secret)) {
    await sql`
      update operators set code_hash = ${hashCode(secret)}, code_is_default = false where id = 1
    `;
    return;
  }
  const rows = await sql<{ code_hash: string | null; code_is_default: boolean }>`
    select code_hash, code_is_default from operators where id = 1
  `;
  const row = rows[0];
  const flag = row?.code_is_default;
  const markedDefault = !row || flag === true || flag === "t" || flag === "true" || flag === 1 || flag === "1";
  if (markedDefault || codesMatch(String(row?.code_hash || ""), "superadmin")) {
    await sql`update operators set code_is_default = true where id = 1`;
  }
}
