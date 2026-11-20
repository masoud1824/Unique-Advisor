/** How an advisor's typed or spoken request uses the internal article library. Nothing here sends mail. */

import { deliveryRequested } from "./workspace-policy.ts";

export type LibraryTurn = "search" | "copy" | "";

const KNOWN_TITLES = [
  "Life Insurance",
  "Time Value Of Money",
  "Retirement Planning",
  "Keeping Beneficiary Information Updated",
  "Practice Follow-Up",
];

export function mentionsArticleLibrary(text: string) {
  const raw = String(text || "");
  if (/\barticle library\b/i.test(raw)) return true;
  return /کتابخانه/.test(raw) && /مقاله/.test(raw);
}

/** Search or copy. A saved-newsletter archive request is not a library request. */
export function asksLibraryConversation(text: string): LibraryTurn {
  const raw = String(text || "");
  if (!mentionsArticleLibrary(raw)) return "";
  if (/\b(?:newsletter archive|saved newsletter cop(?:y|ies)|archived issues?)\b/i.test(raw)) return "";
  if (/بایگانی|آرشیو/.test(raw) && !/کتابخانه/.test(raw)) return "";
  const copying = /\b(?:copy|copies|copied|add|put)\b/i.test(raw) || /کپی|بگذار/.test(raw);
  const intoNewsletter = /\bnewsletters?\b/i.test(raw) || /خبرنامه/.test(raw);
  if (copying && intoNewsletter) return "copy";
  if (/\b(?:search|find|look(?:\s+through)?|which)\b/i.test(raw) || /جستجو|پیدا|بگرد/.test(raw)) return "search";
  return "";
}

export function librarySearchTerm(text: string) {
  const raw = String(text || "");
  const quoted = raw.match(/[“"']([^"”']{2,80})[”"']/)?.[1]?.trim() || "";
  if (quoted) return quoted;
  if (/ارزش زمانی/.test(raw) || /time value of money/i.test(raw)) return "time value of money";
  const named = KNOWN_TITLES.find((title) => raw.toLowerCase().includes(title.toLowerCase()));
  if (named) return named;
  const phrase = raw.match(/\b(?:for|about|on)\s+(?:the\s+)?(.{3,80}?)(?:[.?]|$)/i)?.[1] || "";
  return phrase.replace(/\b(?:do not|don't|without|recipients?|newsletter|article library)\b[\s\S]*$/i, "").trim();
}

export function libraryCopyTitles(text: string) {
  const raw = String(text || "");
  const quoted = [...raw.matchAll(/[“"']([^"”']{2,80})[”"']/g)].map((match) => match[1].trim());
  const known = KNOWN_TITLES.filter((title) => raw.toLowerCase().includes(title.toLowerCase()));
  const titles = [...quoted, ...known];
  if (/ارزش زمانی/.test(raw) && !titles.some((title) => /time value/i.test(title))) titles.push("Time Value Of Money");
  if (/بیمه عمر|بیمه زندگی/.test(raw) && !titles.some((title) => /life insurance/i.test(title))) titles.push("Life Insurance");
  return [...new Set(titles)];
}

export function libraryCopyMode(text: string): "new" | "append" {
  const raw = String(text || "");
  if (/\b(?:existing|current|open|append)\b/i.test(raw) || /موجود/.test(raw)) return "append";
  return "new";
}

export function libraryNewsletterId(text: string) {
  const match = String(text || "").match(/\b(?:newsletter|issue|copy)\s*(?:number|no\.?|#)?\s*(\d+)\b/i);
  return match ? Number(match[1]) : 0;
}

export function libraryTurnAllowsSend(text: string) {
  return deliveryRequested(text);
}

export function formatLibrarySearch(term: string, hits: Array<{ id: number; title: string; version: number; sourceNote: string }>) {
  if (!hits.length) return `No published article library entry matches “${term}”. Drafts stay hidden. Nothing was copied or sent.`;
  return [
    `Published article library matches for “${term}”:`,
    ...hits.map((hit) => `- #${hit.id} “${hit.title}” version ${hit.version}${hit.sourceNote ? ` — source: ${hit.sourceNote}` : ""}`),
    "Nothing was copied or sent.",
  ].join("\n");
}

export function formatLibraryCopy(input: { newsletterId: number; count: number; mode: "new" | "append" }) {
  const where = input.mode === "append" ? "existing newsletter" : "new newsletter";
  return `Saved ${where} ${input.newsletterId} with ${input.count} library snapshots. No recipients were added. Nothing was sent. A later library edit will not change this copy.`;
}
