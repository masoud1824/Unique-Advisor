import { createHash } from "node:crypto";

export type DeskSessionRow = { advisorId: number; slug: string; codeHash: string; expiresAt: string; token: string };

const COOKIE = "ua_desk";
export const DESK_COOKIE = COOKIE;
export const DESK_MAX_AGE = 30 * 24 * 60 * 60;
export const DESK_STORAGE_KEY = "ua-desk-session";

export function hashDeskToken(token: string, secret = "") {
  const material = secret ? `${secret}:${token}` : token;
  return createHash("sha256").update(material).digest("hex");
}

export type StoredDeskSession = {
  tokenHash: string;
  advisorId: number;
  slug: string;
  codeHash: string;
  expiresAt: string;
};

export function acceptStoredSession(
  records: StoredDeskSession[],
  token: string,
  secret: string,
  advisor: { id: number; slug: string; code_hash: string | null },
  now = new Date(),
) {
  const hashes = new Set([hashDeskToken(token, secret), hashDeskToken(token)]);
  const row = records.find((item) => hashes.has(item.tokenHash) && item.slug === advisor.slug);
  if (!row) return null;
  const session = { advisorId: row.advisorId, slug: row.slug, codeHash: row.codeHash, expiresAt: row.expiresAt };
  return sessionStillValid(session, advisor, now) ? session : null;
}

export function sessionStillValid(session: { advisorId: number; slug: string; codeHash: string; expiresAt: string }, advisor: { id: number; slug: string; code_hash: string | null }, now = new Date()) {
  if (!advisor.code_hash) return false;
  if (session.slug !== advisor.slug) return false;
  if (Number(session.advisorId) !== Number(advisor.id)) return false;
  if (session.codeHash !== advisor.code_hash) return false;
  return new Date(session.expiresAt).getTime() > now.getTime();
}

export function deskSetCookie(token: string, opts: { secure: boolean; domain?: string }) {
  const parts = [
    `${COOKIE}=${token}`,
    `Max-Age=${DESK_MAX_AGE}`,
    "Path=/",
    "HttpOnly",
    opts.secure ? "Secure" : "",
    "SameSite=Lax",
    opts.domain ? `Domain=${opts.domain}` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

export function cookieDomain(host: string) {
  const name = host.split(":")[0].trim().toLowerCase();
  if (name === "youradviser.grok.me" || name.endsWith(".youradviser.grok.me")) return "youradviser.grok.me";
  return "";
}

export function readCookieToken(header: string) {
  const match = header.match(/(?:^|;\s*)ua_desk=([^;]+)/);
  return match?.[1]?.trim() || "";
}

export function signedInFromCookie(input: {
  setCookie: string;
  advisor: { id: number; slug: string; code_hash: string };
  session: { advisorId: number; slug: string; codeHash: string; expiresAt: string };
}) {
  const token = readCookieToken(input.setCookie);
  if (token.length < 32) return false;
  return sessionStillValid(input.session, input.advisor);
}
