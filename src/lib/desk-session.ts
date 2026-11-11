import { randomBytes } from "node:crypto";
import { deleteCookie, getCookie, getRequestHeader, getRequestHost, getRequestProtocol, setCookie } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";
import { cookieDomain, hashDeskToken, type DeskSessionRow } from "@/lib/desk-session-check";

export { sessionStillValid } from "@/lib/desk-session-check";
export type { DeskSessionRow };

const COOKIE = "ua_desk";
const MAX_AGE = 30 * 24 * 60 * 60;

function tokenHash(token: string, secret = "") {
  return hashDeskToken(token, secret);
}

async function ready() {
  const sql = await getSql();
  await sql`
    create table if not exists desk_sessions (
      token_hash text primary key,
      advisor_id integer not null,
      slug text not null,
      code_hash text not null,
      expires_at timestamptz not null
    )
  `;
  await sql`
    create table if not exists desk_session_secret (
      id integer primary key,
      secret text not null
    )
  `;
  return sql;
}

async function sessionSecret(sql: Awaited<ReturnType<typeof ready>>) {
  const rows = await sql<{ secret: string }>`select secret from desk_session_secret where id = 1`;
  const saved = String(rows[0]?.secret || "").trim();
  if (saved) return saved;
  const secret = randomBytes(32).toString("hex");
  await sql`
    insert into desk_session_secret (id, secret)
    values (1, ${secret})
    on conflict (id) do nothing
  `;
  const again = await sql<{ secret: string }>`select secret from desk_session_secret where id = 1`;
  return String(again[0]?.secret || secret);
}

function requestHost() {
  try {
    return getRequestHost({ xForwardedHost: true }) || "";
  } catch {
    return "";
  }
}

function requestIsSecure() {
  const host = requestHost().split(":")[0].toLowerCase();
  if (host === "youradviser.grok.me" || host.endsWith(".youradviser.grok.me")) return true;
  try {
    return getRequestProtocol() === "https";
  } catch {
    return false;
  }
}

function writeDeskCookie(token: string) {
  const domain = cookieDomain(requestHost());
  const secure = requestIsSecure();
  setCookie(COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    ...(domain ? { domain } : {}),
  });
}

function presentedTokens() {
  let cookie = "";
  let header = "";
  try {
    cookie = getCookie(COOKIE) || "";
  } catch {
    cookie = "";
  }
  try {
    header = getRequestHeader("x-ua-desk") || "";
  } catch {
    header = "";
  }
  const tokens = [cookie, header].map((value) => value.trim()).filter((value) => value.length >= 32);
  return [...new Set(tokens)];
}

export async function startDeskSession(row: { id: number; slug: string; code_hash: string | null }) {
  if (!row.code_hash) return "";
  const sql = await ready();
  const secret = await sessionSecret(sql);
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + MAX_AGE * 1000).toISOString();
  await sql`delete from desk_sessions where advisor_id = ${row.id} and expires_at <= now()`;
  await sql`
    insert into desk_sessions (token_hash, advisor_id, slug, code_hash, expires_at)
    values (${tokenHash(token, secret)}, ${row.id}, ${row.slug}, ${row.code_hash}, ${expires})
  `;
  try {
    writeDeskCookie(token);
  } catch {
    /* The browser can still keep the token from the response body. */
  }
  return token;
}

async function findSession(sql: Awaited<ReturnType<typeof ready>>, token: string, secret: string) {
  const hashes = [...new Set([tokenHash(token, secret), tokenHash(token)])];
  for (const hash of hashes) {
    const rows = await sql<{ advisor_id: number; slug: string; code_hash: string; expires_at: string }>`
      select advisor_id, slug, code_hash, expires_at from desk_sessions where token_hash = ${hash} limit 1
    `;
    if (rows[0]) return { row: rows[0], hash };
  }
  return null;
}

export async function readDeskSession(slug: string): Promise<DeskSessionRow | null> {
  const tokens = presentedTokens();
  if (!tokens.length) return null;
  const sql = await ready();
  const secret = await sessionSecret(sql);
  for (const token of tokens) {
    const found = await findSession(sql, token, secret);
    if (!found || found.row.slug !== slug) continue;
    if (new Date(found.row.expires_at).getTime() <= Date.now()) {
      await sql`delete from desk_sessions where token_hash = ${found.hash}`;
      continue;
    }
    return {
      advisorId: Number(found.row.advisor_id),
      slug: found.row.slug,
      codeHash: found.row.code_hash,
      expiresAt: new Date(found.row.expires_at).toISOString(),
      token,
    };
  }
  return null;
}

export async function slideDeskSession(slug: string) {
  const tokens = presentedTokens();
  if (!tokens.length) return;
  const sql = await ready();
  const secret = await sessionSecret(sql);
  const expires = new Date(Date.now() + MAX_AGE * 1000).toISOString();
  for (const token of tokens) {
    const found = await findSession(sql, token, secret);
    if (!found || found.row.slug !== slug) continue;
    await sql`update desk_sessions set expires_at = ${expires} where token_hash = ${found.hash} and slug = ${slug}`;
    try {
      writeDeskCookie(token);
    } catch {
      /* sliding the row is enough when the browser keeps the token itself */
    }
    return;
  }
}

export async function clearDeskSession(advisorId?: number) {
  const sql = await ready();
  const secret = await sessionSecret(sql);
  for (const token of presentedTokens()) {
    const found = await findSession(sql, token, secret);
    if (found) await sql`delete from desk_sessions where token_hash = ${found.hash}`;
  }
  if (advisorId) await sql`delete from desk_sessions where advisor_id = ${advisorId}`;
  try {
    deleteCookie(COOKIE, { path: "/" });
  } catch {
    /* no response to write */
  }
}
