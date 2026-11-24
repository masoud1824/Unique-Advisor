import { lookup } from "node:dns/promises";
import { OUTBOUND_BLOCKED, outboundBlocked } from "./outbound-guard.ts";
import type { FormChoice, SavedLink } from "./desk-workflows.ts";
import { chooseSavedLink, formsFromPage } from "./desk-workflows.ts";

export const FORM_WEB_ASK = "I could not find this form in Useful Links. Would you like me to search online?";

const STOP = new Set(["form", "forms", "application", "applications", "find", "search", "please", "from", "with", "that", "this", "your", "useful", "link", "links", "library"]);

export function formWebPrompt(request: string) {
  const form = String(request || "").replace(/\s+/g, " ").trim().slice(0, 180);
  return `${FORM_WEB_ASK}\nForm requested: ${form}`;
}

export function pendingFormRequest(lastAssistant: string) {
  const text = String(lastAssistant || "");
  if (!text.includes(FORM_WEB_ASK)) return "";
  return text.match(/Form requested: (.+)/)?.[1]?.trim() || "";
}

export function isFormWebAgreement(text: string, lastAssistant: string) {
  if (!pendingFormRequest(lastAssistant)) return false;
  return /^(?:yes|yeah|yep|ok|okay|please do|search the web|search online|yes, search the web|yes, search online)\.?$/i.test(String(text || "").trim());
}

export function linksForFormRequest(links: SavedLink[], request: string) {
  const named = chooseSavedLink(links, request);
  if (named.length) return named;
  const words = String(request || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !STOP.has(word));
  if (!words.length) return [];
  return links.filter((link) => {
    const hay = `${link.label} ${link.url}`.toLowerCase();
    return words.some((word) => hay.includes(word));
  });
}

export function publicHttpsTarget(value: string): { ok: true; href: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return { ok: false, reason: "That address is not a public https URL." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only a public https address can be opened." };
  if (url.username || url.password) return { ok: false, reason: "An address with a username or password was not opened." };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") {
    return { ok: false, reason: "A local or internal address was not opened." };
  }
  if (isPrivateAddress(host)) return { ok: false, reason: "A private network address was not opened." };
  url.hash = "";
  return { ok: true, href: url.href };
}

function isPrivateAddress(host: string) {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f.]+$/i.test(host)) return true;
  if (/^(?:\d{1,3}\.){1,2}\d{1,3}$/.test(host)) return true;
  const v6 = host.split("%")[0];
  if (v6 === "::1" || v6 === "::") return true;
  if (/^f[cd]/i.test(v6) || /^fe[89ab]/i.test(v6)) return true;
  return false;
}

export type PublicRead = { ok: true; text: string; finalUrl: string; contentType?: string } | { ok: false; blocked: true } | { ok: false; blocked: false; access: string };

const READ_LIMIT = 1_500_000;
const LIBRARY_TYPES = ["text/html", "application/xhtml+xml", "application/pdf"];

export type HostLookup = (host: string) => Promise<string[]>;

export async function resolvePublicAddresses(host: string) {
  const found = await lookup(host, { all: true, verbatim: true });
  return found.map((item) => item.address);
}

/** A saved Useful Link may be read while mail, uploads, and other provider calls stay blocked. */
function contentTypeOf(response: Response) {
  return (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
}

async function hostIsPublic(host: string, lookupHost: HostLookup) {
  if (isPrivateAddress(host)) return "A private network address was not opened.";
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) return "";
  let addresses: string[] = [];
  try {
    addresses = await lookupHost(host);
  } catch {
    return "The address could not be checked. That is an access failure, not a missing form.";
  }
  if (!addresses.length || addresses.some((address) => isPrivateAddress(address))) return "A private network address was not opened.";
  return "";
}

export function sameLibrarySite(pageUrl: string, documentUrl: string) {
  const page = publicHttpsTarget(pageUrl);
  const document = publicHttpsTarget(documentUrl);
  if (!page.ok || !document.ok) return false;
  const left = new URL(page.href).hostname.toLowerCase();
  const right = new URL(document.href).hostname.toLowerCase();
  return left === right;
}

export async function readApprovedUsefulLink(value: string, fetchImpl: typeof fetch = fetch, lookupHost: HostLookup = resolvePublicAddresses): Promise<PublicRead> {
  let current = publicHttpsTarget(value);
  if (!current.ok) return { ok: false, blocked: false, access: current.reason };
  for (let hop = 0; hop < 3; hop += 1) {
    const host = new URL(current.href).hostname.toLowerCase();
    const blockedHost = await hostIsPublic(host, lookupHost);
    if (blockedHost) return { ok: false, blocked: false, access: blockedHost };
    let response: Response;
    try {
      response = await fetchImpl(current.href, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml,application/pdf", "User-Agent": "UniqueAdvisorFormLookup/1.0" },
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      return { ok: false, blocked: false, access: "The page did not open. That is an access failure, not a missing form." };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      if (!location) return { ok: false, blocked: false, access: "The page redirect had no destination. That is an access failure, not a missing form." };
      const next = publicHttpsTarget(new URL(location, current.href).href);
      if (!next.ok) return { ok: false, blocked: false, access: next.reason };
      current = next;
      continue;
    }
    if (!response.ok) return { ok: false, blocked: false, access: `The page did not open (${response.status}). That is an access failure, not a missing form.` };
    const type = contentTypeOf(response);
    if (!LIBRARY_TYPES.includes(type)) return { ok: false, blocked: false, access: `The page type ${type || "unknown"} was not opened. That is an access failure, not a missing form.` };
    const declared = Number(response.headers.get("content-length") || "0");
    if (declared > READ_LIMIT) return { ok: false, blocked: false, access: "The page was larger than the read limit. That is an access failure, not a missing form." };
    const text = type === "application/pdf" ? "" : (await response.text()).slice(0, READ_LIMIT);
    return { ok: true, text, finalUrl: current.href, contentType: type };
  }
  return { ok: false, blocked: false, access: "The page redirected too many times. That is an access failure, not a missing form." };
}

export async function verifySavedDocument(value: string, fetchImpl: typeof fetch = fetch, lookupHost: HostLookup = resolvePublicAddresses): Promise<{ ok: true; href: string; contentType: string } | { ok: false; access: string }> {
  let current = publicHttpsTarget(value);
  if (!current.ok) return { ok: false, access: current.reason };
  for (let hop = 0; hop < 3; hop += 1) {
    const host = new URL(current.href).hostname.toLowerCase();
    const blockedHost = await hostIsPublic(host, lookupHost);
    if (blockedHost) return { ok: false, access: blockedHost };
    let response: Response;
    try {
      response = await fetchImpl(current.href, {
        method: "HEAD",
        redirect: "manual",
        headers: { Accept: "application/pdf,text/html", "User-Agent": "UniqueAdvisorFormLookup/1.0" },
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      return { ok: false, access: "The form file did not open. That is an access failure, not a missing form." };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      if (!location) return { ok: false, access: "The form file redirect had no destination. That is an access failure, not a missing form." };
      const next = publicHttpsTarget(new URL(location, current.href).href);
      if (!next.ok) return { ok: false, access: next.reason };
      current = next;
      continue;
    }
    if (!response.ok) return { ok: false, access: `The form file did not open (${response.status}). That is an access failure, not a missing form.` };
    const type = contentTypeOf(response);
    if (type !== "application/pdf" && type !== "text/html") return { ok: false, access: `The form file type ${type || "unknown"} was not accepted. That is an access failure, not a missing form.` };
    return { ok: true, href: current.href, contentType: type };
  }
  return { ok: false, access: "The form file redirected too many times. That is an access failure, not a missing form." };
}

/** Wider web and unsaved addresses stay closed while outbound is blocked. */
export async function readPublicHttps(value: string, fetchImpl: typeof fetch = fetch): Promise<PublicRead> {
  if (outboundBlocked()) return { ok: false, blocked: true };
  let current = publicHttpsTarget(value);
  if (!current.ok) return { ok: false, blocked: false, access: current.reason };
  for (let hop = 0; hop < 3; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current.href, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    } catch {
      return { ok: false, blocked: false, access: "The page did not open. That is an access failure, not a missing form." };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      let absolute = location;
      try {
        absolute = new URL(location, current.href).href;
      } catch {
        absolute = location;
      }
      const next = publicHttpsTarget(absolute);
      if (!next.ok) return { ok: false, blocked: false, access: next.reason };
      current = next;
      continue;
    }
    if (!response.ok) return { ok: false, blocked: false, access: `The page did not open (${response.status}). That is an access failure, not a missing form.` };
    const text = (await response.text()).slice(0, 1500000);
    return { ok: true, text, finalUrl: current.href };
  }
  return { ok: false, blocked: false, access: "The page redirected too many times. That is an access failure, not a missing form." };
}

export function publicResultLinks(html: string) {
  const found: Array<{ title: string; href: string }> = [];
  const seen = new Set<string>();
  const pattern = /<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const raw = decodeURIComponent(match[1].replace(/&/gi, "&"));
    const wrapped = raw.match(/[?&]uddg=([^&]+)/)?.[1];
    const candidate = wrapped ? decodeURIComponent(wrapped) : raw;
    const target = publicHttpsTarget(candidate);
    if (!target.ok) continue;
    if (/duckduckgo\.com/i.test(target.href)) continue;
    if (seen.has(target.href)) continue;
    seen.add(target.href);
    const title = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    if (title) found.push({ title, href: target.href });
    if (found.length >= 5) break;
  }
  return found;
}

export function usefulLinkMiss(request: string) {
  return formWebPrompt(request);
}

export function savedLinkBlockedNote(label: string, href: string) {
  return [
    `Saved Useful Link: ${label}`,
    href,
    "The linked form library was not opened because outbound reads are blocked in this environment. That is an access limit, not a missing form. I did not search online. Nothing was filled, saved, or uploaded.",
  ].join("\n");
}

export function matchSavedFormLinks(links: SavedLink[], request: string) {
  const named = /\b(?:canada life|manulife|sun life|assumption|empire life|industrial alliance|rbc insurance|desjardins|ivari|equitable)\b/i.test(request);
  return named ? chooseSavedLink(links, request) : linksForFormRequest(links, request);
}

/** Lookup result before any fill, save, or upload. A blocked page read is not a miss. */
export function explainFormLookup(input: {
  links: SavedLink[];
  request: string;
  page?: { ok: true } | { ok: false; blocked: boolean; access?: string };
}) {
  const matched = matchSavedFormLinks(input.links, input.request);
  if (!matched.length) return formWebPrompt(input.request);
  if (matched.length > 1) return `Which saved page?\n${matched.map((link) => `- ${link.label}`).join("\n")}\nNothing was sent.`;
  const link = matched[0];
  if (!/^https:\/\//i.test(link.url)) return "That Useful Link is not a secure page. I did not open it, and I did not call the form missing.";
  if (/\.pdf(?:$|\?)/i.test(link.url)) return foundFormNote(link.label, link.url, link.label);
  if (!input.page) return "";
  if (!input.page.ok) {
    if (input.page.blocked) return savedLinkBlockedNote(link.label, link.url);
    return `Saved Useful Link: ${link.label}\n${link.url}\n${input.page.access || "The page did not open."} That is an access failure, not a missing form. I did not search online. Nothing was filled or uploaded.`;
  }
  return "";
}

export function blockedReadNote() {
  return `${OUTBOUND_BLOCKED} The page was not opened, and that was not treated as not found.`;
}

export function webSearchBlockedNote() {
  return "The wider web was not searched. Outbound reads are blocked in this environment. Nothing was opened.";
}

export function foundFormNote(label: string, href: string, title: string) {
  return `Saved Useful Link: ${label}\nForm: ${title}\n${href}\nThis is the verified form link from that library. Nothing was filled, saved, uploaded, or sent.`;
}

export function webResultsNote(request: string, links: Array<{ title: string; href: string }>) {
  if (!links.length) return `The public search ran for “${request}” and returned no form page. Nothing was opened.`;
  return [
    `Public pages for “${request}”. Nothing was sent or uploaded.`,
    ...links.map((link) => `- ${link.title} — ${link.href}`),
  ].join("\n");
}

export async function searchPublicFormPages(request: string, fetchImpl: typeof fetch = fetch) {
  if (outboundBlocked()) return webSearchBlockedNote();
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${request} official form`)}`;
  const read = await readPublicHttps(url, fetchImpl);
  if (!read.ok) {
    if (read.blocked) return webSearchBlockedNote();
    return `${read.access} The wider web search did not finish, so I did not call the form missing.`;
  }
  return webResultsNote(request, publicResultLinks(read.text));
}

export function formsOnSavedPage(html: string, pageUrl: string, request: string): FormChoice[] {
  return formsFromPage(html, pageUrl).filter((form) => {
    const hay = `${form.title} ${form.purpose}`.toLowerCase();
    const words = request.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4 && !STOP.has(word));
    if (!words.length) return true;
    return words.some((word) => hay.includes(word));
  });
}
