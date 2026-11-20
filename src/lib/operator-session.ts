import { randomBytes } from "node:crypto";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

const COOKIE = "ua_operator";
const DAY_MS = 24 * 60 * 60 * 1000;

function store() {
  const globalRef = globalThis as typeof globalThis & { __uaOperatorSessions?: Map<string, number> };
  globalRef.__uaOperatorSessions ??= new Map();
  return globalRef.__uaOperatorSessions;
}

export function readOperatorCookie(header: string | null) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function operatorSessionValid(token: string) {
  if (!token) return false;
  const expires = store().get(token);
  if (!expires || expires < Date.now()) {
    store().delete(token);
    return false;
  }
  return true;
}

export function startOperatorSession() {
  const token = randomBytes(32).toString("hex");
  store().set(token, Date.now() + DAY_MS);
  return token;
}

export function endOperatorSession(token: string) {
  if (token) store().delete(token);
}

export function operatorCookie(token: string, secure: boolean) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=86400"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearOperatorCookie(secure: boolean) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function requestIsSecure(request: Request) {
  if (request.headers.get("x-forwarded-proto") === "https") return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function previewAdminLocation(request: Request, notice = "") {
  const referer = request.headers.get("referer") || "";
  let target = "/admin";
  try {
    const ref = new URL(referer);
    const prefix = previewPathPrefix(ref.hostname, ref.pathname) || "";
    target = `${ref.origin}${prefix}/admin`;
  } catch {
    /* keep the local admin path */
  }
  if (!notice) return target;
  const url = new URL(target, "http://127.0.0.1");
  url.searchParams.set("notice", notice);
  return target.startsWith("http") ? url.toString() : `${url.pathname}${url.search}`;
}
