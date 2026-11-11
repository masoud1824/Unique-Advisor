import { hasMeetingWhen, isTimeAgreement } from "./meeting-time.ts";
import { refersToAppointment } from "./calendar-span.ts";

const SKIP = new Set(["a", "an", "the", "thank", "you", "thanks", "card", "cards", "ecard", "ecards", "please", "send", "to", "with", "for", "zoom", "meeting", "book", "booked", "look", "at", "massage", "message", "and", "give", "greeting", "greetings", "birthday", "holiday", "holidays", "welcome", "halloween", "season", "seasons", "seasonal", "anniversary", "norooz", "nowruz"]);

export function tidyHeard(text: string) {
  return text
    .replace(/\b(?:massage|message)\s+to\b/gi, "to")
    .replace(/\blook\s+at\b/gi, "book a")
    .replace(/\bbooked\s+a\b/gi, "book a")
    .replace(/\bbook\s+at\b/gi, "book a")
    .replace(/\s+/g, " ")
    .trim();
}

function writtenCard(tidy: string) {
  return /\b(?:e-?cards?|greeting\s+cards?)\b/i.test(tidy) || (/\bcards?\b/i.test(tidy) && /\b(?:send|give|mail)\b/i.test(tidy));
}

function occasionCard(tidy: string) {
  if (/\b(?:e-?letters?|newsletters?|letters?|notes?|emails?)\b/i.test(tidy) && !/\bcards?\b/i.test(tidy)) return false;
  if (/\b(?:season'?s?|seasons|seasonal)\s+greetings?\b/i.test(tidy)) return true;
  if (/\bholiday\s+greetings?\b/i.test(tidy)) return true;
  const occasion = /\b(?:thank(?:\s+you)?|thanks|birthday|halloween|welcome|anniversary|norooz|nowruz|holidays?)\b/i.test(tidy);
  if (!occasion) return false;
  if (/\b(?:send|give|mail)\b/i.test(tidy)) return true;
  return /^(?:please\s+)?(?:a\s+|an\s+|the\s+)?(?:thank(?:\s+you)?|thanks|birthday(?:\s+wishes)?|halloween|welcome|anniversary|(?:happy\s+)?holidays?|norooz|nowruz)(?:\s+to\s+\p{L}.+)?[.!?]?$/iu.test(tidy);
}

export function isCardAsk(text: string) {
  const tidy = tidyHeard(text);
  if (writtenCard(tidy)) return true;
  if (/\b(?:thank(?:\s+you)?|birthday|holiday|welcome|halloween|anniversary|norooz|nowruz)\s+cards?\b/i.test(tidy)) return true;
  return occasionCard(tidy);
}

export function ruleCardPhrases(rules: Array<{ text?: string; on?: boolean }> | undefined) {
  const phrases: string[] = [];
  for (const rule of rules || []) {
    if (rule.on === false) continue;
    const text = String(rule.text || "").replace(/\s+/g, " ").trim();
    if (!/\b(?:e-?cards?|cards?)\b/i.test(text)) continue;
    for (const match of text.matchAll(/[“"]([^"”]{2,80})[”"]/g)) phrases.push(match[1].trim());
    const said = text.match(/\b(?:when i (?:say|ask|type|write)|if i (?:say|ask|type|write))\s+(.{2,160})/i);
    const chunk = said ? said[1].split(/[.]/)[0] : "";
    for (const part of chunk.split(/\s+\bor\b\s+|,\s*/i)) {
      const phrase = part
        .replace(/^(?:please\s+)?(?:to\s+)?send\s+/i, "")
        .replace(/\b(?:treat(?:\s+it)?\s+as|means?|it(?:'s| is)?|that(?:'s| is)?|should be|send(?:\s+the)?|an?\s+e-?card|the\s+e-?card|e-?card|card)\b.*$/i, "")
        .replace(/^(?:a|an|the)\s+/i, "")
        .replace(/[,:;]+$/g, "")
        .trim();
      if (phrase.length >= 2 && phrase.length <= 60) phrases.push(phrase);
    }
  }
  return [...new Set(phrases.map((phrase) => phrase.replace(/\s+/g, " ").trim()).filter((phrase) => phrase.length >= 2))];
}

export function textHitsRuleCard(text: string, rules: Array<{ text?: string; on?: boolean }> | undefined) {
  const tidy = tidyHeard(text).toLowerCase();
  if (/[?]/.test(tidy) && !/\b(?:e-?cards?|greeting\s+cards?)\b/i.test(tidy)) return false;
  const noise = new Set(["time", "what", "who", "when", "where", "how", "which", "that", "this", "it", "is", "are", "the", "a", "to", "for", "with", "my", "please"]);
  return ruleCardPhrases(rules).some((phrase) => {
    const folded = phrase.toLowerCase().trim();
    if (folded.length < 4) return false;
    const words = folded.split(/\s+/).filter((word) => word && !noise.has(word));
    if (!words.length) return false;
    return tidy.includes(folded);
  });
}

export function isZoomAsk(text: string) {
  const tidy = tidyHeard(text);
  return /\b(?:book(?:ed)?\s+(?:a\s+)?zoom|book\s+zoom|zoom\s+meeting)\b/i.test(tidy);
}

const NOT_NAME = new Set(["using", "use", "fictional", "fiction", "test", "testing", "placeholder", "placeholders", "sample", "demo", "demonstrate", "demonstration", "onboarding", "intake", "checklist", "details", "detail", "prepare", "preparation", "request", "requests", "search", "save", "saved", "send", "schedule", "anything", "supplied", "looking", "creating", "without", "conversation", "record", "records", "draft", "drafts", "this", "these", "client", "clients", "contact", "contacts", "not", "do", "what", "when", "where", "who", "why", "how", "which", "is", "are", "was", "it", "that", "those", "time", "appointment", "appointments", "answer", "sentence", "changing", "summarize", "summary", "show", "list", "tell"]);

function plainWord(word: string) {
  return word.replace(/[.,!?;:]+$/g, "").replace(/-/g, "").toLowerCase();
}

export function looksLikeInstruction(value: string) {
  const words = String(value || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((word) => word.length > 1);
  if (!words.length) return false;
  const marked = words.filter((word) => NOT_NAME.has(word) || SKIP.has(word)).length;
  return marked >= Math.min(2, words.length) && marked / words.length >= 0.5;
}

function keptNameWords(tail: string) {
  const cut = tail.split(/[.!?]|\bdo not\b/i)[0] || "";
  const words: string[] = [];
  for (const word of cut.split(/\s+/)) {
    const raw = word.replace(/[.,!?;:]+$/g, "");
    const plain = plainWord(raw);
    if (!plain || SKIP.has(plain) || /^\d/.test(plain) || /^(?:a|p)\.?m\.?$/i.test(plain)) continue;
    if (NOT_NAME.has(plain)) {
      if (plain === "example" && words.length > 0) words.push(raw);
      continue;
    }
    words.push(raw);
  }
  return words.slice(0, 3).join(" ");
}

export function contactPhrase(text: string) {
  const tidy = tidyHeard(text);
  const question = /[?]/.test(tidy) || /^(?:what|who|when|where|why|how|which|summarize|draft)\b/i.test(tidy);
  const found = tidy.match(/\b(?:to|with|for)\s+([^.?!]+)/i);
  if (question && !found) return "";
  const tail = (found ? found[1] : tidy).replace(/\b(?:tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b.*$/i, " ");
  return keptNameWords(tail);
}

export function cardTitleHint(text: string) {
  if (/\bthank(?:\s+you)?\b/i.test(text) || /\bthanks\b/i.test(text)) return "Thank You";
  if (/\b(?:season'?s?|seasons|seasonal)\s+greetings?\b/i.test(text)) return "Season's Greetings";
  if (/\bbirthday\b/i.test(text)) return "Birthday Wishes";
  if (/\bholidays?\b/i.test(text)) return "Holiday Greeting";
  if (/\bwelcome\b/i.test(text)) return "Welcome";
  return "";
}

const CARD_FILLER = new Set(["a", "an", "the", "card", "cards", "ecard", "ecards", "please", "send", "to", "my", "me", "for", "one", "just", "with"]);

function foldToken(word: string) {
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Compare spoken card names with the titles on this advisor's desk. */
export function cardLabelKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((word) => foldToken(word))
    .map((word) => (word === "seasonal" ? "season" : word))
    .filter((word) => word.length > 1 && !CARD_FILLER.has(word))
    .join(" ");
}

export type CardPick = { id: string; title: string };

export function matchCardByName(text: string, cards: CardPick[]): { card: CardPick } | { cards: CardPick[] } | undefined {
  const query = cardLabelKey(text);
  if (query.length < 2) return undefined;
  const queryWords = query.split(" ");
  const querySet = new Set(queryWords);
  const ranked = cards.map((card) => {
    const key = cardLabelKey(card.title);
    if (!key) return { card, score: 0 };
    if (key === query) return { card, score: 100 };
    const titleWords = key.split(" ");
    const titleInQuery = titleWords.every((word) => querySet.has(word));
    const queryInTitle = queryWords.every((word) => titleWords.includes(word));
    if (queryInTitle && titleInQuery) return { card, score: 96 };
    if (titleInQuery) return { card, score: 84 + Math.min(titleWords.length, 5) };
    if (queryInTitle) return { card, score: 74 + Math.min(queryWords.length, 5) };
    if (key.includes(query) || query.includes(key)) return { card, score: 70 };
    const shared = titleWords.filter((word) => querySet.has(word)).length;
    if (shared > 0) return { card, score: 40 + shared * 12 };
    return { card, score: 0 };
  }).filter((item) => item.score >= 52);
  if (!ranked.length) return undefined;
  ranked.sort((left, right) => right.score - left.score || left.card.title.localeCompare(right.card.title));
  const top = ranked[0].score;
  const tied = ranked.filter((item) => item.score === top);
  const keys = new Set(tied.map((item) => cardLabelKey(item.card.title)));
  if (keys.size === 1 && top >= 74) {
    tied.sort((left, right) => right.card.title.length - left.card.title.length);
    return { card: tied[0].card };
  }
  if (tied.length === 1 && top >= 74) return { card: tied[0].card };
  return { cards: ranked.filter((item) => item.score >= 52).slice(0, 4).map((item) => item.card) };
}

export function cardDoubtLine(titles: string[], name = "") {
  const cards = titles.map((title) => title.trim()).filter(Boolean).slice(0, 4).map((title) => `the ${title} card`);
  const who = name.trim() ? ` for ${name.trim()}` : "";
  if (cards.length === 0) return name.trim() ? `Which e-card should I send to ${name.trim()}?` : "Which e-card did you mean?";
  if (cards.length === 1) return `Did you mean ${cards[0]}${who}?`;
  if (cards.length === 2) return `Did you mean ${cards[0]} or ${cards[1]}${who}?`;
  return `Did you mean ${cards.slice(0, -1).join(", ")}, or ${cards[cards.length - 1]}${who}?`;
}

export type HeardJob = { job: string; card: string; contact: string; rewrite: string; unsure: boolean; ask: string };

export function parseHeardJob(text: string): HeardJob | null {
  const start = String(text || "").indexOf("{");
  const end = String(text || "").lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(String(text).slice(start, end + 1)) as Record<string, unknown>;
    const job = String(raw.job || "").toLowerCase().trim();
    const allowed = new Set(["card", "newsletter", "eletter", "campaign", "inbox", "file", "review", "calendar", "meeting", "several", "chat"]);
    if (!allowed.has(job)) return null;
    const clip = (value: unknown, max: number) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
    return { job, card: clip(raw.card, 80), contact: clip(raw.contact, 80), rewrite: clip(raw.rewrite, 500), unsure: raw.unsure === true, ask: clip(raw.ask, 280) };
  } catch {
    return null;
  }
}

export function heardCommand(heard: HeardJob) {
  if (heard.job === "chat" || heard.unsure) return "";
  const rewrite = heard.rewrite || (heard.job === "card" && heard.card ? (heard.contact ? `send the ${heard.card} e-card to ${heard.contact}` : `send the ${heard.card} e-card`) : "");
  if (!rewrite || agreesToSendCard(rewrite) || declinesCard(rewrite)) return "";
  return rewrite;
}

export function rewriteAllowed(original: string, rewrite: string) {
  if (isOnboardingDemo(original)) return false;
  const left = taskKind(original);
  const right = taskKind(rewrite);
  if (!left || !right) return true;
  return left === right;
}

export function cardDoubtAllowed(original: string, job: string) {
  if (job !== "card") return true;
  const kind = taskKind(original);
  return !kind || kind === "e-card";
}

export function grokDoubtReply(heard: HeardJob) {
  const ask = heard.ask.replace(/\s+/g, " ").trim();
  if (!ask) return "";
  if (/^did you mean\b/i.test(ask)) return ask.endsWith("?") ? ask : `${ask}?`;
  if (heard.job === "card" && !/\bcard\b/i.test(ask)) return `Did you mean the ${ask.replace(/[?.!]+$/g, "")} card?`;
  return ask.endsWith("?") ? ask : `${ask}?`;
}

export function deskKeepsTurn(text: string, lastAssistant = "") {
  const tidy = tidyHeard(text);
  const last = String(lastAssistant || "");
  if (!tidy) return false;
  if (isTextEdit(tidy) || isRevisionAsk(tidy) || asksForPlan(tidy) || asksToResume(tidy) || blocksLookup(tidy)) return false;
  const askingCard = /which e-card should i send/i.test(last)
    || (/did you mean\b/i.test(last) && /\bcard\b/i.test(last))
    || /which contact should i send it to/i.test(last);
  if (!(askingCard && tidy.length <= 80) && taskKind(tidy) && !agreesToSendCard(tidy) && !declinesCard(tidy)) return false;
  if (agreesToSendCard(tidy) || declinesCard(tidy)) return true;
  if (/^change(?: the)? time\b/i.test(tidy)) return true;
  if (isTimeAgreement(tidy) && /\b(?:zoom|meeting|book it|toronto time)\b|\d{1,2}:\d{2}\s*[ap]\.?m/i.test(last)) return true;
  if (askingCard && tidy.length <= 80 && !isNewsletterAsk(tidy) && !isZoomAsk(tidy) && !isNewsletterEdit(tidy)) return true;
  if (/which part should i take out/i.test(last) && tidy.length < 80 && !taskKind(tidy)) return true;
  if (isNewsletterEdit(tidy)) return true;
  return false;
}

export function cardConfirmLine(title: string, name: string) {
  return `Just to confirm: send the ${title} e-card to ${name}?`;
}

export function agreesToSendCard(text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  if (isCardAsk(trimmed) && contactPhrase(trimmed).length >= 2) return false;
  if (isTimeAgreement(trimmed)) return true;
  return /^(?:please\s+)?send(?:\s+it|\s+the\s+(?:e-?)?card|\s+that)\b[.!]?$/i.test(trimmed);
}

export function declinesCard(text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed || hasMeetingWhen(trimmed)) return false;
  if (isCardAsk(trimmed) && contactPhrase(trimmed).length >= 2) return false;
  if (isRevisionAsk(trimmed)) return false;
  return /^(?:no|nope|nah|cancel|stop|don'?t|do not|never\s?mind)\b[.!]?$/i.test(trimmed);
}

function workClauses(text: string) {
  return tidyHeard(text).split(/[.;]+/).map((clause) => clause.trim()).filter(Boolean);
}

export function asksToComposeEmail(text: string) {
  return workClauses(text).some((clause) => {
    if (/\b(?:leave|keep|hold|park|set aside|forget)\b/i.test(clause) && !/\b(?:write|compose|prepare|create)\b/i.test(clause)) return false;
    return /\b(?:draft|write|compose|prepare|create)\b[\s\S]{0,80}\b(?:email|e-?letter|letter|note)\b/i.test(clause);
  });
}

function clauseRequestsPlan(clause: string) {
  if (/\b(?:draft|write|compose|prepare|create)\b[\s\S]{0,40}\b(?:email|e-?letter|letter|checklist)\b/i.test(clause)) return false;
  const list = /\b(?:bullets?|points?|priorit(?:y|ies)|list|agenda|things|items)\b/i.test(clause);
  const work = /\b(?:workload|organi[sz]|tomorrow|morning|today|tasks?|tackle|handle|work)\b/i.test(clause);
  const direct = /\bwhat should i\b[\s\S]{0,40}\b(?:do|handle|tackle)\b/i.test(clause) && /\b(?:tomorrow|today|morning)\b/i.test(clause);
  return (list && work) || direct;
}

export function asksForPlan(text: string) {
  const clauses = workClauses(text);
  const latest = [...clauses].reverse().find((clause) => clauseRequestsPlan(clause) || asksToComposeEmail(clause) || (/\bchecklist\b/i.test(clause) && /\b(?:draft|write|prepare|create)\b/i.test(clause)));
  return Boolean(latest && clauseRequestsPlan(latest));
}

export function asksToResume(text: string) {
  const tidy = tidyHeard(text);
  if (asksForPlan(tidy) || asksToComposeEmail(tidy) || /\b(?:rewrite|revise|reword|shorten|translate|reorganize)\b/i.test(tidy)) return false;
  return /\b(?:go back|return|reopen|bring back|back to|show|pull up)\b[\s\S]{0,40}\b(?:earlier|previous|last)\b[\s\S]{0,30}\b(?:email|e-?letter|letter|draft|checklist)\b/i.test(tidy)
    || /\b(?:go back|return|bring back|back to)\b[\s\S]{0,40}\b(?:email|e-?letter|letter|draft|checklist)\b/i.test(tidy);
}

export function workloadPlan(text: string) {
  const tidy = tidyHeard(text);
  const named = tidy.match(/\b(one|two|three|four|five|\d+)\b/i)?.[1].toLowerCase() || "";
  const counts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const count = Math.min(5, Math.max(1, named ? counts[named] || Number(named) || 3 : 3));
  const when = /\btomorrow\b/i.test(tidy) ? "tomorrow" : /\bmorning\b/i.test(tidy) ? "this morning" : "today";
  const guard = /\b(?:do not|don't|without)\b[\s\S]{0,120}\b(?:search|save|send|schedul|book)/i.test(tidy)
    ? "Nothing was searched, saved, sent, or scheduled."
    : "";
  if (requestedLanguage(text) === "farsi") {
    const lines = [
      "تقویم را قبل از افزودن کار جدید بررسی کنید.",
      "پیگیری‌هایی را که منتظر تصمیم شما هستند مشخص کنید.",
      "پیش‌نویس‌هایی را که هنوز تصمیم لازم دارند جدا کنید.",
      "برای پیام‌های همان روز وقت بگذارید.",
      "کارهایی را که می‌توانند بمانند یادداشت کنید.",
    ].slice(0, count).map((item) => `- ${item}`);
    return ["برنامه کار", ...lines, "چیزی جست‌وجو، ذخیره، ارسال یا زمان‌بندی نشد."].join("\n");
  }
  const lines = [
    `Check the calendar for ${when} before adding anything new.`,
    "Decide which follow-ups are waiting on you.",
    "Group the drafts that still need a decision.",
    "Leave time for messages that arrive during the day.",
    "Note anything that can wait until the next day.",
  ].slice(0, count).map((item) => `- ${item}`);
  return [`Workload for ${when}`, ...lines, guard].filter(Boolean).join("\n");
}

export function earlierDraftReply(text: string, thread: Array<{ role?: string; content?: string }>) {
  const tidy = tidyHeard(text);
  const wantChecklist = /\bchecklist\b/i.test(tidy) && !/\b(?:email|e-?letter|letter)\b/i.test(tidy);
  const wantEmail = /\b(?:email|e-?letter|letter|draft)\b/i.test(tidy);
  const messages = (thread || []).filter((turn) => turn.role === "assistant").map((turn) => String(turn.content || ""));
  const picked = [...messages].reverse().find((content) => {
    if (wantChecklist) return /\bchecklist\b/i.test(content);
    if (wantEmail) return /^Subject:/m.test(content) || /^Hello\b|^Dear\b|^Welcome email/m.test(content);
    return /^Subject:/m.test(content) || /\bchecklist\b/i.test(content);
  });
  if (!picked) return "I do not have an earlier draft in this conversation. Nothing was saved or sent.";
  return `Earlier draft, unchanged. Nothing was saved or sent.\n\n${picked}`;
}

export function isTaskSwitch(text: string) {
  const tidy = tidyHeard(text);
  if (/\b(?:for it|for that|for this appointment|for the appointment|for the meeting)\b/i.test(tidy) && !/\b(?:leave|cancel|stop|unrelated|instead)\b/i.test(tidy)) return false;
  if (/\b(?:leave|drop|stop|abandon|exit|forget)\b[\s\S]{0,60}\b(?:checklist|draft|email|letter|workflow|task|that|this)\b/i.test(tidy)) return true;
  if (/\b(?:instead|unrelated|different|another|new)\b/i.test(tidy) && /\b(?:draft|write|prepare|create|request|checklist|email|letter|note)\b/i.test(tidy)) return true;
  if (/\b(?:cancel|stop)\b/i.test(tidy) && /\b(?:draft|write|prepare|request|checklist|email|letter)\b/i.test(tidy)) return true;
  const pointsAtPrevious = /\b(?:that email|this email|the email|that letter|this letter|the letter|that checklist|this checklist|the checklist|the draft|this draft)\b/i.test(tidy);
  const freshDocument = /\b(?:draft|write|prepare|create)\b[\s\S]{0,80}\b(?:email|e-?letter|letter|note)\b/i.test(tidy);
  return freshDocument && !pointsAtPrevious;
}

export function isStandaloneDraft(text: string) {
  const tidy = tidyHeard(text);
  if (asksForPlan(tidy) || asksToResume(tidy)) return false;
  if (/\b(?:for it|for that|for this appointment|for the appointment|for the meeting)\b/i.test(tidy) && !/\b(?:leave|cancel|stop|unrelated|instead)\b/i.test(tidy)) return false;
  if (asksToComposeEmail(tidy)) return /\b(?:fictional|placeholder|demonstration|demo client|sample client|do not|don't)\b/i.test(tidy);
  const checklist = /\b(?:draft|write|prepare|create|request)\b/i.test(tidy) && /\bchecklist\b/i.test(tidy);
  if (!checklist) return false;
  return /\b(?:fictional|placeholder|demonstration|demo client|sample client|leave|cancel|stop|unrelated|instead|another|different)\b/i.test(tidy);
}

function requestedLanguage(text: string) {
  const marks = [...String(text || "").matchAll(/\benglish\b|\bfarsi\b|\bpersian\b|فارسی/gi)];
  const last = marks.at(-1)?.[0].toLowerCase() || "";
  if (last === "فارسی" || last.startsWith("far") || last === "persian") return "farsi" as const;
  return "english" as const;
}

function draftClientName(text: string) {
  const named = String(text || "").match(/\bclient\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})/u)
    || String(text || "").match(/\bfor\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})/u);
  const candidate = named?.[1]?.replace(/[.,!?;:]+$/g, "") || "";
  if (!candidate || looksLikeInstruction(candidate)) return "the client";
  return candidate;
}

function limitWords(text: string, limit: number) {
  if (!(limit > 0)) return text;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text;
  return `${words.slice(0, limit).join(" ").replace(/[.,:;]+$/g, "")}.`;
}

export function freshDraft(text: string) {
  const tidy = tidyHeard(text);
  const guard = "Nothing was searched, saved, sent, or booked. No contact was looked up and no record was deleted.";
  const left = /\b(?:leave|cancel|stop|drop)\b/i.test(tidy) ? "The earlier draft was left. No pending action was sent." : "";
  const asksDraft = asksToComposeEmail(tidy) || (/\b(?:draft|write|prepare|create|request)\b/i.test(tidy) && /\bchecklist\b/i.test(tidy));
  if (!asksDraft) return [left || "The earlier draft was left unsent. Nothing was saved or sent.", guard].join("\n");
  const wantsEmail = asksToComposeEmail(tidy);
  if (!wantsEmail && /\bchecklist\b/i.test(tidy) && !/\b(?:for it|for that|for the appointment|for the meeting)\b/i.test(tidy)) {
    return ["Checklist draft", left, "This is a new checklist, not the previous appointment checklist.", "- Purpose: Unknown", "- Documents: Unknown", "- Follow-up: Unknown", guard].filter(Boolean).join("\n");
  }
  const name = draftClientName(text);
  const language = requestedLanguage(text);
  const limit = Number(tidy.match(/\bunder\s+(\d+)\s+words\b/i)?.[1] || 0);
  const minutes = Number(tidy.match(/\b(\d+)\s*-?\s*minutes?\b/i)?.[1] || 0);
  const invite = minutes > 0 && /\b(?:invite|call|meeting|introductory)\b/i.test(tidy);
  let body = language === "farsi"
    ? `سلام ${name}. خوش آمدید.`
    : /\bwarm\b/i.test(tidy) ? `Hello ${name}, welcome. I am glad you are here.` : `Hello ${name}, welcome.`;
  if (invite) {
    body += language === "farsi"
      ? ` هر وقت آماده بودید می‌توانیم یک تماس معرفی ${minutes} دقیقه‌ای ترتیب دهیم. زمان مشخصی پیشنهاد نمی‌کنم.`
      : ` When you are ready, we can arrange a ${minutes}-minute introductory call. I am not proposing a specific time.`;
  }
  if (language !== "farsi") body += " Please reply when you would like to take the next step.";
  body = limitWords(body, limit).replace(/\b\d{1,2}:\d{2}\s*[ap]\.?m\.?\b/gi, "").replace(/\s+/g, " ").trim();
  return ["Welcome email draft", left, guard, "", body].filter((line) => line !== "").join("\n");
}

export function isRevisionAsk(text: string) {
  const tidy = tidyHeard(text);
  if (/^(?:yes|yeah|yep|no|nope|cancel|stop)\b[.!]?$/i.test(tidy)) return false;
  if (isTaskSwitch(tidy)) return false;
  if (/^(?:please\s+)?draft\b/i.test(tidy) && !/\b(?:rewrite|revise|reword|shorten|translate|reorganize)\b/i.test(tidy)) return false;
  return /\b(?:rewrite|revise|reword|shorten|condense|expand|reorganize|reorganise|rearrange|restructure|separate|split into|translate|translation|paraphrase|rephrase|under \d+ words|add a request|add a|two sections|known details|information needed)\b/i.test(tidy)
    || /\b(?:in|into|to)\s+(?:farsi|persian)\b/i.test(tidy)
    || /فارسی/.test(tidy)
    || /\bmark\b[\s\S]{0,40}\bunknown\b/i.test(tidy);
}

export function isCancellation(text: string) {
  return declinesCard(text);
}

export function pendingQuestion(lastAssistant: string) {
  const last = String(lastAssistant || "");
  if (/just to confirm:|shall i book|press approve and send/i.test(last)) return "confirm" as const;
  if (/\b(?:draft only|revised draft|checklist|intake request)\b/i.test(last)) return "draft" as const;
  return "" as const;
}

export function yesApplies(text: string, lastAssistant: string) {
  if (!agreesToSendCard(text) && !isTimeAgreement(text)) return false;
  return pendingQuestion(lastAssistant) === "confirm";
}

export function shouldIgnorePending(text: string, lastAssistant: string) {
  if (!pendingQuestion(lastAssistant)) return false;
  if (yesApplies(text, lastAssistant)) return false;
  if (isCancellation(text) || isRevisionAsk(text)) return true;
  return Boolean(taskKind(text));
}

export function showUnclearChoice(userText: string, previousReply: string, nextReply: string) {
  const tidy = tidyHeard(userText);
  if (!previousReply || !nextReply) return false;
  if (isRevisionAsk(tidy) || isCancellation(tidy) || shouldIgnorePending(tidy, previousReply)) return false;
  if (!agreesToSendCard(tidy) && !declinesCard(tidy) && tidy.length > 40) return false;
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const left = norm(previousReply);
  const right = norm(nextReply);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length > 30 && longer.includes(shorter.slice(0, 48));
}

function wordCount(value: string) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function quotedRemovals(instruction: string) {
  const phrases: string[] = [];
  for (const match of String(instruction || "").matchAll(/\b(?:remove|delete|drop|omit|cut)\b[^"“”']{0,40}[“"']([^"”']{2,200})[”"']/gi)) phrases.push(match[1].trim());
  return phrases.filter(Boolean);
}

function dropSentences(text: string, phrases: string[]) {
  const sentences = String(text || "").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const kept = sentences.filter((sentence) => !phrases.some((phrase) => sentence.toLowerCase().includes(phrase.toLowerCase())));
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

function bodyOnly(instruction: string) {
  return /\b(?:show|return|give|display)\s+only\b|\bonly the (?:subject|email|body)\b/i.test(instruction);
}

function realApproval(previous: string) {
  return /just to confirm:|press approve and send|shall i book/i.test(previous);
}

function subjectLine(previous: string, instruction: string, body: string) {
  const existing = String(previous || "").match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || "";
  if (existing && !/\b(?:change|rewrite|new)\b[\s\S]{0,20}\bsubject\b/i.test(instruction)) return existing;
  if (/\bwelcome\b/i.test(`${body}\n${instruction}`)) return "Welcome";
  if (/\bintroductory call\b/i.test(`${body}\n${instruction}`)) return "Introductory call";
  return existing || "Note";
}

function stripDraftGuards(previous: string) {
  return String(previous || "")
    .replace(/^Revised draft\s*/i, "")
    .replace(/\n+Nothing was searched[\s\S]*$/i, "")
    .replace(/\n+This draft was not sent[\s\S]*$/i, "")
    .replace(/\n+The earlier approval[\s\S]*$/i, "")
    .replace(/\n+The meeting was not scheduled\.?\s*$/i, "")
    .trim();
}

function draftFacts(previous: string) {
  const body = stripDraftGuards(previous);
  const time = body.match(/\b\d{1,2}:\d{2}\s*[AP]M\b/i)?.[0] || "";
  const title = body.match(/checklist for\s+(.+?)\s+at\s+\d/i)?.[1]
    || body.match(/Appointment:\s*([^\n]+)/i)?.[1]
    || body.match(/Known details:\s*(.+?)\s+at\s+\d/i)?.[1]
    || "";
  return { body, time, title: title.replace(/\.$/, "").trim() };
}

function statedValue(body: string, label: string) {
  const found = body.match(new RegExp(`(?:^|\\n)-?\\s*${label}\\s*:\\s*([^\\n]+)`, "i"));
  const value = found?.[1]?.trim() || "";
  return value && !/^unknown$/i.test(value) ? value : "";
}

function sectionDraft(previous: string) {
  const { body, time, title } = draftFacts(previous);
  const known = [
    title ? `Appointment: ${title}` : "",
    time ? `Time: ${time}` : "",
  ].filter(Boolean);
  if (!known.length) known.push("No confirmed details are in the previous draft.");
  const needed = ["Location", "Purpose", "Documents", "Follow-ups"].map((label) => `${label}: ${statedValue(body, label) || "Unknown"}`);
  return { known, needed, time, title };
}

function guardLine(previous: string, instruction: string) {
  const handsOff = /\b(?:do not|don't|without)\b[\s\S]{0,140}\b(?:search|save|send|schedule|change)/i.test(`${previous}\n${instruction}`);
  return handsOff
    ? "Nothing was searched, saved, sent, or changed."
    : "This draft was not sent. The earlier approval no longer applies because the draft changed.";
}

function persianTime(time: string) {
  const match = time.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!match) return time;
  const digits = (value: string) => value.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
  return `${digits(match[1])}:${digits(match[2])} ${match[3].toUpperCase() === "PM" ? "بعدازظهر" : "صبح"}`;
}

function toFarsi(previous: string, instruction: string) {
  const { known, needed, time, title } = sectionDraft(previous);
  const appointment = title || "قرار";
  const when = time ? persianTime(time) : "نامشخص";
  const neededText = needed.map((line) => {
    const [label, value] = line.split(/:\s*/);
    const names: Record<string, string> = { Location: "مکان", Purpose: "هدف", Documents: "مدارک", "Follow-ups": "پیگیری‌ها" };
    return `${names[label] || label}: ${value === "Unknown" ? "نامشخص" : value}`;
  });
  return [
    "جزئیات مشخص",
    `- قرار: ${appointment}`,
    `- ساعت: ${when}`,
    "",
    "اطلاعات مورد نیاز",
    ...neededText.map((line) => `- ${line}`),
    "",
    "چیزی جست‌وجو، ذخیره، ارسال یا تغییر داده نشد.",
    known.join(" ") ? "" : instruction,
  ].filter((line) => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function generalRevision(previous: string, instruction: string) {
  const guard = guardLine(previous, instruction);
  if (/\b(?:farsi|persian|فارسی)\b/i.test(instruction)) return toFarsi(previous, instruction);
  const { known, needed, time, title } = sectionDraft(previous);
  const sections = /\b(?:separate|reorganize|reorganise|rearrange|restructure|two sections|known details|information needed)\b/i.test(instruction);
  const shorten = /\b(?:shorten|condense)\b/i.test(instruction);
  if (shorten && !sections) {
    const subject = [title, time].filter(Boolean).join(" at ");
    const text = subject
      ? `Known details: ${subject}. Information needed: location, purpose, documents, and follow-ups are unknown.`
      : "Known details: only what the previous draft stated. Information needed: anything not stated is unknown.";
    return `${text}\n${guard}`;
  }
  if (sections && shorten) {
    const subject = [title, time].filter(Boolean).join(" at ");
    return `Known details: ${subject || "only the details already stated"}.\nInformation needed: location, purpose, documents, and follow-ups are unknown.\n${guard}`;
  }
  if (sections) {
    return [
      "Known details",
      ...known.map((line) => `- ${line}`),
      "",
      "Information needed",
      ...needed.map((line) => `- ${line}`),
      "",
      guard,
    ].join("\n");
  }
  if (shorten) {
    const words = stripDraftGuards(previous).split(/\s+/).filter(Boolean);
    const limit = Math.max(12, Math.ceil(words.length * 0.6));
    return `${words.slice(0, limit).join(" ").replace(/[.,:;]+$/g, "")}.\n${guard}`;
  }
  return `${stripDraftGuards(previous)}\n\n${guard}`;
}

export function revisionFollows(previous: string, instruction: string, next: string) {
  const tidy = String(next || "").trim();
  if (tidy.length < 20) return false;
  if (/\b(?:could not find|i searched your contacts|was sent|is booked|was scheduled|i have scheduled)\b/i.test(tidy)) return false;
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff ]/g, " ").replace(/\s+/g, " ").trim();
  if (norm(tidy) === norm(previous)) return false;
  const limit = Number(instruction.match(/\bunder\s+(\d+)\s+words\b/i)?.[1] || 0);
  if (limit > 0 && wordCount(tidy) >= limit) return false;
  for (const phrase of quotedRemovals(instruction)) {
    if (phrase && tidy.toLowerCase().includes(phrase.toLowerCase())) return false;
  }
  if (/\b(?:invite|ask)\b[\s\S]{0,80}\b(?:suggest|choose)\b[\s\S]{0,40}\b(?:time|day)\b/i.test(instruction) && !/\bsuggest\b/i.test(tidy)) return false;
  if (bodyOnly(instruction)) {
    if (!/^Subject:/m.test(tidy)) return false;
    if (/\b(?:approval|not scheduled|nothing was searched|revised draft)\b/i.test(tidy)) return false;
  }
  if (/\b(?:shorten|condense)\b/i.test(instruction) && wordCount(tidy) >= wordCount(previous)) return false;
  if (/\b(?:farsi|persian|فارسی)\b/i.test(instruction) && !/[\u0600-\u06FF]/.test(tidy)) return false;
  if (/\b(?:known details|information needed|two sections|separate|reorganize|reorganise)\b/i.test(instruction)) {
    if (!/known details|جزئیات مشخص/i.test(tidy) || !/information needed|اطلاعات مورد نیاز/i.test(tidy)) return false;
  }
  if (/\bunknown\b/i.test(instruction) && !/\bunknown\b|نامشخص/i.test(tidy)) return false;
  const invented = tidy.match(/\b\d{1,5}\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,2}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd)\b/g) || [];
  if (invented.some((place) => !previous.includes(place))) return false;
  return true;
}

export function revisionOf(previous: string, instruction: string) {
  if (isTaskSwitch(instruction)) return freshDraft(instruction);
  const emailLike = /^Hello\b|^Dear\b/m.test(previous) || /\nHello\b|\nDear\b/.test(previous);
  const structured = /\b(?:separate|reorganize|reorganise|rearrange|restructure|two sections|known details|information needed|translate|translation|farsi|persian|فارسی|shorten|condense)\b/i.test(instruction);
  if (!emailLike || structured && !/\b(?:under\s+\d+\s+words|change the tone|different tone|add a)\b/i.test(instruction)) {
    return generalRevision(previous, instruction);
  }
  const limit = Number(instruction.match(/\bunder\s+(\d+)\s+words\b/i)?.[1] || 0);
  const minutes = Number(instruction.match(/\b(\d+)\s*-?\s*minutes?\b/i)?.[1] || 0);
  const handsOff = /\b(?:do not|don't|without)\b[\s\S]{0,120}\b(?:search|save|send|schedul|book)/i.test(`${previous}\n${instruction}`);
  const emailStart = previous.search(/^Hello\b|^Dear\b/m);
  const after = emailStart >= 0 ? previous.slice(emailStart) : previous;
  const endInAfter = after.search(/\n(?:Checklist\b|Unverified\b|Completed:|Nothing was|The earlier approval|The meeting was not)/i);
  let email = (endInAfter > 0 ? after.slice(0, endInAfter) : after).replace(/\s+/g, " ").trim();
  const originalEmail = email;
  email = dropSentences(email, quotedRemovals(instruction));
  if (/\b(?:formal|professional|change the tone|different tone)\b/i.test(instruction)) {
    email = email.replace(/^Hello\s+([^,]+),/i, "Dear $1,");
    if (!/^Dear\b/i.test(email)) email = `Dear client, ${email}`;
  } else if (/\b(?:warm|warmly|friendly|natural|naturally|casual)\b/i.test(instruction)) {
    email = email.replace(/^Dear\s+([^,]+),/i, "Hello $1,");
  }
  const suggest = /\b(?:invite|ask)\b[\s\S]{0,80}\b(?:suggest|choose)\b[\s\S]{0,40}\b(?:time|day)\b/i.test(instruction);
  if (minutes && !suggest && !new RegExp(`\\b${minutes}\\s*-?\\s*minutes?\\b`, "i").test(email)) {
    email = `${email} Would a ${minutes}-minute introductory meeting work for you?`.replace(/\s+/g, " ").trim();
  }
  if (suggest && !/\bsuggest a convenient time\b/i.test(email)) {
    const call = minutes ? `a ${minutes}-minute introductory call` : "a call";
    email = `${email} Please suggest a convenient time for ${call}.`.replace(/\s+/g, " ").trim();
  }
  if (/\b(?:warm|warmly|natural|naturally)\b/i.test(instruction)) {
    email = email
      .replace(/\bI am glad you are here\.\s*/i, "")
      .replace(/\bWhen you are ready, we can arrange\b/i, "I would be glad to arrange")
      .replace(/\bPlease reply when you would like to take the next step\.?\s*/i, "")
      .replace(/\bwelcome\.\s*/i, "it is a pleasure to welcome you. ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (suggest) email = email.replace(/[^.!?]*\barrange\b[^.!?]*[.!?]?/gi, " ").replace(/\s+/g, " ").trim();
  if (/\benglish\b/i.test(instruction)) email = email.replace(/[\u0600-\u06FF]+/g, " ").replace(/\s+/g, " ").trim();
  if (email === originalEmail && /\b(?:revise|rewrite|reword)\b/i.test(instruction)) {
    email = email.replace(/\bwelcome\.\s*/i, "It is a pleasure to welcome you. ").replace(/\s+/g, " ").trim();
    if (email === originalEmail) email = `${email} I look forward to your reply.`.replace(/\s+/g, " ").trim();
  }
  const subject = `Subject: ${subjectLine(previous, instruction, email)}`;
  const reserve = bodyOnly(instruction) ? wordCount(subject) : 0;
  const room = limit > reserve ? limit - reserve : limit;
  if (room > 0) email = limitWords(email, room);
  if (bodyOnly(instruction)) {
    let shown = `${subject}\n\n${email}`;
    if (limit > 0 && wordCount(shown) >= limit) shown = `${subject}\n\n${limitWords(email, Math.max(1, limit - wordCount(subject) - 1))}`;
    return shown;
  }
  const guard = handsOff
    ? "Nothing was searched, saved, sent, or scheduled."
    : "This draft was not sent.";
  return [
    "Revised draft",
    "",
    email,
    "",
    guard,
    realApproval(previous) ? "The earlier approval no longer applies because the draft changed." : "",
  ].filter((line) => line !== "").join("\n");
}

export function revisionMessages(previous: string, instruction: string, history: Array<{ role: string; content: string }>) {
  return [
    { role: "system", content: "Revise the current draft to follow the latest instruction. Remove any quoted text the instruction says to remove. Stay under a word limit when one is given. If asked for only a subject and email body, return only those and do not add approval, scheduling, or status lines. Mention an earlier approval only when the current draft itself is waiting for approval. Do not invent an approval. Do not search, save, send, schedule, book, or change records. Do not return the previous draft unchanged." },
    ...history.slice(-6).map((turn) => ({ role: turn.role === "assistant" ? "assistant" : "user", content: String(turn.content || "").slice(0, 2000) })),
    { role: "user", content: `Current draft:\n${previous.slice(0, 4000)}\n\nLatest instruction:\n${instruction.slice(0, 1000)}` },
  ];
}

function turnsSinceLastCommand(messages: Array<{ role: string; content: string }>) {
  const recent: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const turn = messages[index];
    if (turn.role === "user") {
      if (agreesToSendCard(turn.content) || declinesCard(turn.content)) continue;
      break;
    }
    if (turn.role === "assistant") recent.push(String(turn.content || ""));
  }
  return recent;
}

function alreadySent(recent: string[], askAt: number) {
  const sentAt = recent.findIndex((content) => /^sent — the\b.+\be-card is on its way\b/i.test(content));
  return sentAt !== -1 && sentAt < askAt;
}

export function cardAwaitingYes(messages: Array<{ role: string; content: string }>) {
  const recent = turnsSinceLastCommand(messages);
  const confirmAt = recent.findIndex((content) => /just to confirm: send the\b.+\be-card to\b/i.test(content) || /shall i prepare it/i.test(content));
  if (confirmAt === -1) return false;
  return !alreadySent(recent, confirmAt);
}

export function cardAwaitingApprove(messages: Array<{ role: string; content: string }>) {
  const recent = turnsSinceLastCommand(messages);
  const approveAt = recent.findIndex((content) => /press approve and send/i.test(content) && /\be-?cards?\b/i.test(content));
  if (approveAt === -1) return false;
  return !alreadySent(recent, approveAt);
}

export function cardSentLine(title: string, names: string[]) {
  const who = names.map((name) => String(name || "").trim()).filter(Boolean);
  const person = who.length === 0
    ? "your contact"
    : who.length === 1
      ? who[0]
      : who.length === 2
        ? `${who[0]} and ${who[1]}`
        : `${who.slice(0, -1).join(", ")}, and ${who[who.length - 1]}`;
  return `Sent — the ${title} e-card is on its way to ${person}.`;
}

export function isNewsletterEdit(text: string) {
  const tidy = tidyHeard(text);
  if (!/\b(?:remove|drop|delete|cut|take out)\b/i.test(tidy)) return false;
  return /\b(?:newsletter|article|part|section|story|paragraph)\b/i.test(tidy);
}

export function newsletterRemoveTarget(text: string) {
  const tidy = tidyHeard(text);
  if (/\b(?:last|final|bottom)\b/i.test(tidy)) return { index: -1, name: "" };
  if (/\b(?:first|top|opening)\b/i.test(tidy)) return { index: 0, name: "" };
  const words = ["second", "third", "fourth", "fifth", "sixth"];
  const wordAt = words.findIndex((item) => new RegExp(`\\b${item}\\b`, "i").test(tidy));
  if (wordAt >= 0) return { index: wordAt + 1, name: "" };
  const numbered = tidy.match(/\b(?:part|article|section|story|number|#)\s*(\d+)\b/i)
    || tidy.match(/\b(\d+)(?:st|nd|rd|th)?\s+(?:part|article|section|story)\b/i)
    || tidy.match(/\b(?:remove|drop|delete|cut)\s+(?:the\s+|part\s+)?(\d+)\b/i);
  if (numbered) return { index: Math.max(0, Number(numbered[1]) - 1), name: "" };
  const leftover = tidy
    .replace(/\b(?:please|can you|could you|just)\b/gi, " ")
    .replace(/\b(?:remove|drop|delete|cut|take out)\b/gi, " ")
    .replace(/\b(?:this|that|the|a|an|part|article|section|story|paragraph|from|newsletter|one|it)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { index: null, name: leftover.length > 2 ? leftover : "" };
}

export function newsletterDropIndex(text: string, titles: string[], choosing = false): number | "ask" | "miss" {
  const tidy = tidyHeard(text);
  const asRemove = choosing && !/\b(?:remove|drop|delete|cut|take out)\b/i.test(tidy) ? `remove ${tidy}` : tidy;
  const target = newsletterRemoveTarget(asRemove);
  if (target.index === -1) return Math.max(0, titles.length - 1);
  if (target.index !== null) return target.index < titles.length ? target.index : "miss";
  if (target.name) {
    const key = target.name.toLowerCase();
    const tokens = key.split(/\s+/).filter((word) => word.length > 2);
    let best = -1;
    let score = 0;
    titles.forEach((title, index) => {
      const folded = title.toLowerCase();
      const hits = tokens.filter((word) => folded.includes(word)).length;
      const next = folded.includes(key) ? 99 : hits;
      if (next > score) {
        score = next;
        best = index;
      }
    });
    return best >= 0 ? best : "miss";
  }
  return titles.length === 1 ? 0 : "ask";
}

export function newsletterReadyLine(title: string, names: string[], articles: string[]) {
  const list = articles.map((item, index) => `${index + 1}. ${item}`).filter(Boolean).join("\n");
  return `${newsletterConfirmLine(title, names)}\n\n${list}\n\nSay yes to send it. Say remove 2, or remove the part by name, to take a part out.`;
}

export function isNewsletterAsk(text: string) {
  const tidy = tidyHeard(text).replace(/\bseznd\b/gi, "send");
  if (isNewsletterEdit(tidy)) return false;
  if (!/\bnewsletters?\b/i.test(tidy)) return false;
  return /\b(?:create|write|make|prepare|draft|send|build|about|with)\b/i.test(tidy);
}

export function newsletterTopics(text: string) {
  const tidy = tidyHeard(text).replace(/\bseznd\b/gi, "send");
  const about = tidy.match(/\b(?:about|regarding|covering|on)\s+(.+)$/i);
  if (!about) return [];
  const rest = about[1]
    .replace(/\s+\b(?:and\s+)?(?:send|email|mail)\b[\s\S]*$/i, "")
    .replace(/\s+\b(?:to|for)\s+[A-Z][\s\S]*$/i, "");
  return rest
    .split(/\s*,\s*|\s+\band\b\s+/i)
    .map((part) => part.replace(/^(?:a|an|the|\d+)\s+/i, "").replace(/[.?!]+$/g, "").trim())
    .filter((part) => part.length > 2 && !/^(?:articles?|stories|story)$/i.test(part))
    .slice(0, 8);
}

export function newsletterRecipients(text: string) {
  const tidy = tidyHeard(text).replace(/\bseznd\b/gi, "send");
  const found = tidy.match(/\b(?:send|email|mail)\s+(?:it\s+)?to\s+(.+)$/i)
    || tidy.match(/\b(?:e-?letter|letter|note)\s+to\s+(.+?)(?=\s+\b(?:about|regarding)\b|$)/i)
    || tidy.match(/\b(?:send|email|mail)\b[\s\S]{0,80}?\bto\s+(.+)$/i)
    || tidy.match(/\bfor\s+((?:[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,2})(?:\s*(?:,|and)\s*(?:[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,2}))*)\s*$/u);
  if (!found) return [];
  return found[1]
    .split(/\s*,\s*|\s+\band\b\s+/i)
    .map((part) => part.replace(/[.?!]+$/g, "").trim())
    .filter((part) => part.length > 1 && !/^(?:me|them|everyone|all)$/i.test(part))
    .slice(0, 8);
}

export function newsletterTitle(topics: string[]) {
  const tidy = topics.map((topic) => topic.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (tidy.length === 0) return "A note from your advisor";
  const label = (topic: string) => topic.replace(/\b\w/g, (letter) => letter.toUpperCase());
  if (tidy.length === 1) return label(tidy[0]).slice(0, 120);
  return `Notes on ${tidy.slice(0, -1).map(label).join(", ")} and ${label(tidy[tidy.length - 1])}`.slice(0, 120);
}

export function newsletterArticle(topic: string) {
  const title = topic.replace(/\s+/g, " ").trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
  const key = title.toLowerCase();
  const lines = /life insurance/.test(key)
    ? [
        "Life insurance is the money a family can use if the person earning the income is no longer there.",
        "A review looks at who is named, how much is in place, and whether a new child, a mortgage, or a business has changed the reason for the coverage.",
        "Last year's amount can be the wrong amount even when the policy is still in force.",
        "This note is not a quote and it is not a recommendation to buy a policy.",
      ]
    : /rrsp|retirement/.test(key)
      ? [
          "An RRSP is a way to set money aside for a later year, and the contribution deadline is a date on the calendar rather than a surprise.",
          "The useful question is whether this year's room has been used, and whether the plan still matches the retirement the household actually wants.",
          "Leaving it until the last week usually means a rushed decision.",
          "This note does not name a deadline date and it is not tax advice.",
        ]
      : /disabilit/.test(key)
        ? [
            "Disability insurance is about income in the months when someone cannot work.",
            "A review asks how long the household could pay its bills, what is already covered at work, and what would still be missing.",
            "The waiting period and the definition of disability are the parts people forget until they need them.",
            "This note is not a quote and it does not say which contract to buy.",
          ]
        : /critical illness|beneficiary|estate|will\b|tfsa|mortgage/.test(key)
          ? [
              `${title} is one of the pieces that should be looked at with the rest of the plan, not on its own.`,
              "A short review checks what is already in place, who is named, and whether a change in the family or the business has left a gap.",
              "The point of the note is to start that conversation, not to choose a product from a page.",
              "Nothing here is a recommendation to buy, sell, or replace a contract.",
            ]
          : [
              `${title} is worth a few minutes before the year moves on.`,
              "Families often leave this until a deadline or an illness makes the choice for them.",
              "A short review can confirm who is covered, what the amount is, and whether the plan still fits the people who depend on that income.",
              "Waiting usually costs more than acting while there is still time to choose.",
            ];
  const body = [...lines, "If you want this looked at for your own situation, reply to this note and we will walk through the next step together."].join(" ");
  return { title, body };
}

export function newsletterConfirmLine(title: string, names: string[]) {
  const who = names.map((name) => String(name || "").trim()).filter(Boolean);
  const person = who.length === 0 ? "your contacts" : who.length === 1 ? who[0] : who.length === 2 ? `${who[0]} and ${who[1]}` : `${who.slice(0, -1).join(", ")}, and ${who[who.length - 1]}`;
  return `Just to confirm: send the newsletter “${title}” to ${person}?`;
}

export function newsletterSentLine(title: string, names: string[]) {
  const who = names.map((name) => String(name || "").trim()).filter(Boolean);
  const person = who.length === 0 ? "your contacts" : who.length === 1 ? who[0] : who.length === 2 ? `${who[0]} and ${who[1]}` : `${who.slice(0, -1).join(", ")}, and ${who[who.length - 1]}`;
  return `Sent — the newsletter “${title}” is on its way to ${person}.`;
}

export function isEletterAsk(text: string) {
  const tidy = tidyHeard(text);
  if (isNewsletterAsk(tidy) || isCardAsk(tidy) || isCampaignAsk(tidy) || isStandaloneDraft(tidy)) return false;
  if (/\be-?letters?\b/i.test(tidy) && /\b(?:create|write|make|prepare|draft|send)\b/i.test(tidy)) return true;
  return /\b(?:write|send|draft|prepare)\b/i.test(tidy) && /\b(?:a\s+)?(?:letter|note|email)\b/i.test(tidy) && /\bto\b/i.test(tidy);
}

const LETTER_STOP = /\s+\b(?:and|to|that|about|regarding|tell|telling|saying|say|ask|asking|request|requesting|invite|inviting)\b/i;

export function eletterRecipient(text: string) {
  const tidy = tidyHeard(text);
  const found = tidy.match(/\b(?:e-?letter|letter|note|email)\s+to\s+(.+)/i);
  if (!found) return "";
  const chunk = found[1].split(LETTER_STOP)[0] || "";
  return chunk.replace(/[.?!]+$/g, "").replace(/^(?:please\s+)/i, "").trim();
}

export function eletterFromRequest(text: string) {
  const tidy = tidyHeard(text);
  const afterName = tidy.match(/\b(?:e-?letter|letter|note|email)\s+to\s+.+?\s+((?:and\s+)?(?:ask|asking|tell|telling|say|saying|request|requesting|invite|inviting|about|regarding)\b[\s\S]+)$/i);
  const told = tidy.match(/\b(?:tell\s+(?:him|her|them)|let\s+(?:him|her|them)\s+know|say(?:\s+that)?|that)\s+(.+)$/i);
  let point = (afterName?.[1] || told?.[1] || "").replace(/^(?:and\s+)/i, "").replace(/[.?!]+$/g, "").trim();
  if (point.length < 8) {
    const about = tidy.match(/\b(?:about|regarding)\s+(.+)$/i);
    point = (about?.[1] || "").replace(/\s+\b(?:and\s+)?(?:send|email|mail)\b[\s\S]*$/i, "").trim();
  }
  if (point.length < 8) return null;
  let sentence = point
    .replace(/^(?:tell|asking|say(?:ing)?)\s+(?:him|her|them)\s+/i, "")
    .replace(/^(?:ask(?:ing)?|request(?:ing)?|invit(?:e|ing))\s+(?:(?:him|her|them)\s+)?(?:for\s+)?/i, "I am writing to ask for ")
    .replace(/^(?:about|regarding)\s+/i, "")
    .replace(/\bits\b/gi, "it is")
    .replace(/\s+and\s+suggest\s+(?:some\s+)?time\s+for\s+/i, ". I would like to suggest a time for ")
    .replace(/\ba zoom\b/gi, "a Zoom meeting")
    .replace(/\bin person meeting\b/gi, "an in-person meeting")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[.!?]$/.test(sentence)) sentence += ".";
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  const title = sentence.replace(/^I am writing to ask for\s+/i, "").split(/[.!?]/)[0].split(/\s+/).slice(0, 8).join(" ");
  const meeting = /\b(?:zoom|in[- ]person|meetings?|appointments?)\b/i.test(`${point} ${sentence}`)
    ? "\n\nPlease use the Book a meeting button in this letter. You can meet by Zoom or in person. The page shows only the times that are still open."
    : "\n\nPlease reply if you would like to go over this.";
  return { title: title.charAt(0).toUpperCase() + title.slice(1), body: `${sentence}${meeting}` };
}

export function isCampaignAsk(text: string) {
  const tidy = tidyHeard(text);
  return /\b(?:drips?|campaigns?)\b/i.test(tidy) && /\b(?:send|run|start|launch)\b/i.test(tidy);
}

export function isInboxAsk(text: string) {
  const tidy = tidyHeard(text);
  if (blocksLookup(tidy) || isTextEdit(tidy) || isCardAsk(tidy) || isNewsletterAsk(tidy) || isEletterAsk(tidy)) return false;
  return /\b(?:read|check|show|open|any|new)\b/i.test(tidy) && /\b(?:e-?mails?|inbox|mailbox)\b/i.test(tidy);
}

export function blocksLookup(text: string) {
  return /\b(?:do not|don't|without|never)\b[\s\S]{0,120}\b(?:search|look\s*up)\b/i.test(text);
}

function withoutProhibitions(text: string) {
  return String(text || "").replace(/\b(?:do not|don't|without|never)\b[\s\S]{0,120}?(?=[.]|$)/gi, " ");
}

const BULLET_ORDINALS: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };

export function isTextEdit(text: string) {
  const tidy = tidyHeard(text);
  if (/^(?:yes|yeah|yep|no|nope|cancel|stop)\b/i.test(tidy)) return false;
  return /\b(?:replace|change|swap|update|edit)\b[\s\S]{0,50}\b(?:bullet|point|line|item|sentence|paragraph|section)\b/i.test(tidy)
    || /\b(?:replace|change|swap)\s+the\s+(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\b/i.test(tidy);
}

function listedLines(text: string) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+\S/.test(line) || /^\d+[.)]\s+\S/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").trim());
}

function listedIndex(text: string) {
  const found = text.match(/\b(?:the\s+)?(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+(?:bullet|point|line|item|sentence)\b/i);
  if (!found) return -1;
  const token = found[1].toLowerCase();
  if (token in BULLET_ORDINALS) return BULLET_ORDINALS[token];
  const number = Number(token.replace(/\D/g, ""));
  return number > 0 ? number - 1 : -1;
}

function replacementFor(text: string) {
  const quoted = text.match(/\b(?:with|to)\b[^"“”']{0,30}[“"']([^"”']{1,240})[”"']/i);
  if (quoted) return quoted[1].trim();
  const plain = text.match(/\b(?:with|to)\s+(.+?)(?:\.|$)/i);
  return plain?.[1]?.replace(/\b(?:show only|do not|don't)\b[\s\S]*$/i, "").trim() || "";
}

export function editListedText(previous: string, instruction: string) {
  const lines = listedLines(previous);
  const index = listedIndex(instruction);
  const next = replacementFor(instruction);
  if (!lines.length || index < 0 || index >= lines.length || !next) {
    return "I could not see which line to change in the previous answer. Nothing was searched or saved.";
  }
  const updated = lines.slice();
  updated[index] = next.replace(/\s+/g, " ").trim();
  return updated.map((line) => `- ${line}`).join("\n");
}

export function isCalendarAsk(text: string) {
  const tidy = tidyHeard(text);
  if (blocksLookup(tidy) || isTextEdit(tidy)) return false;
  const allowed = withoutProhibitions(tidy);
  if (isZoomAsk(allowed) || isCardAsk(allowed) || isNewsletterAsk(allowed) || isEletterAsk(allowed) || isCampaignAsk(allowed)) return false;
  if (/\b(?:book|schedule|set up)\b/i.test(allowed) && /\b(?:zoom|meeting|appointment)\b/i.test(allowed)) return false;
  if (/\bcalendars?\b/i.test(allowed)) return true;
  return /\b(?:show|see|read|check|what(?:'s| is)|list)\b/i.test(allowed) && /\b(?:meetings?|appointments?|schedule|agenda)\b/i.test(allowed);
}

export function isReviewAsk(text: string) {
  const tidy = tidyHeard(text);
  if (blocksLookup(tidy) || isTextEdit(tidy) || isCardAsk(tidy) || isNewsletterAsk(tidy) || isEletterAsk(tidy) || isCampaignAsk(tidy)) return false;
  return /\b(?:kyc|cross-?sell|upsell|not contacted|who should i (?:call|meet|see|contact)|who do i (?:call|meet|see|contact)|who (?:needs|is due)|which clients? (?:need|needs|are due|is due|should)|needs? a (?:meeting|review)|review clients|clients? (?:need|needs) (?:a )?review|due (?:for|to) (?:a )?(?:review|contact|call|kyc)|hasn'?t been contacted|have not been contacted|needs attention|overdue)\b/i.test(tidy);
}

export function isFileAsk(text: string) {
  const tidy = tidyHeard(text);
  if (blocksLookup(tidy) || isTextEdit(tidy) || isCardAsk(tidy) || isNewsletterAsk(tidy) || isEletterAsk(tidy) || isCampaignAsk(tidy) || isInboxAsk(tidy)) return false;
  return /\b(?:products?|history|file|tell me about|what do we know|kyc|pull up|on file)\b/i.test(tidy)
    && !/\b(?:who|whose|everyone|all contacts|due)\b/i.test(tidy);
}

export function fileSubject(text: string) {
  const tidy = tidyHeard(text);
  const found = tidy.match(/\b(?:about|for|on|does|with)\s+([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,2})/i);
  const fromCue = (found ? found[1] : "").replace(/\b(?:have|has|need|needs|hold|holds)$/i, "").trim();
  if (fromCue.length > 1 && !looksLikeInstruction(fromCue) && !/^(?:his|her|their|the|a|an|file|products?)$/i.test(fromCue)) return fromCue;
  const names = tidy.match(/\b[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){0,2}\b/g) || [];
  const person = names
    .map((name) => name.replace(/[.,!?;:]+/g, " ").split(/\s+/).filter((word) => word && !NOT_NAME.has(word.toLowerCase()) && !SKIP.has(word.toLowerCase())).slice(0, 3).join(" "))
    .find((name) => name.length > 1 && !looksLikeInstruction(name));
  if (person) return person;
  return contactPhrase(tidy);
}

export function isOnboardingDemo(text: string) {
  const tidy = tidyHeard(text);
  const asks = /\b(?:onboarding|intake|checklist)\b/i.test(tidy);
  const fictional = /\b(?:fictional|placeholder|demonstrate|demonstration)\b/i.test(tidy);
  const handsOff = /\bdo not\b[\s\S]{0,160}\b(?:search|save|send|schedule)\b/i.test(tidy);
  return asks && fictional && handsOff;
}

export function onboardingDraft(text: string) {
  const named = text.match(/\bclient\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})/u);
  const candidate = named?.[1] || "";
  const name = candidate && !looksLikeInstruction(candidate) ? candidate : "Alex Example";
  return [
    `Onboarding demonstration for fictional client ${name}.`,
    "Nothing was searched, saved, sent, or scheduled. No contact record was created.",
    "",
    "Intake request (draft only)",
    "To: placeholder, not a saved contact",
    "Subject: Please complete your new-client intake",
    `Hello ${name},`,
    "This is a draft intake request using placeholder details. It was not sent.",
    "Please complete the checklist when the advisor asks you to. Leave the signature for yourself.",
    "",
    "Checklist",
    `- Full name: ${name} (fictional label, not a file lookup)`,
    "- Email: alex.example@example.com (placeholder)",
    "- Phone: 555-0100 (placeholder)",
    "- Date of birth: not supplied",
    "- Address: not supplied",
    "- Identification: not supplied",
    "- Existing policies: not supplied",
    "- Beneficiary: not supplied",
    "- Signature: left blank for the client",
    "",
    "Unverified and left blank: date of birth, address, identification, policies, and beneficiary.",
    "Completed: this draft and checklist only.",
    "Pending: your review. A saved contact is not required for this draft.",
  ].join("\n");
}

export function eletterConfirmLine(title: string, names: string[]) {
  return `Just to confirm: send the e-letter “${title}” to ${whoLine(names)}?`;
}

export function campaignConfirmLine(name: string, names: string[], every: string) {
  return `Just to confirm: start the ${name} campaign, ${every}, for ${whoLine(names)}?`;
}

function whoLine(names: string[]) {
  const who = names.map((name) => String(name || "").trim()).filter(Boolean);
  if (who.length === 0) return "your contacts";
  if (who.length === 1) return who[0];
  if (who.length === 2) return `${who[0]} and ${who[1]}`;
  return `${who.slice(0, -1).join(", ")}, and ${who[who.length - 1]}`;
}

export function eletterAwaitingYes(messages: Array<{ role: string; content: string }>) {
  return awaitingKind(messages, /just to confirm: send the e-letter\b/i, /^sent — the e-letter\b/i);
}

export function campaignAwaitingYes(messages: Array<{ role: string; content: string }>) {
  return awaitingKind(messages, /just to confirm: start the\b.+\bcampaign\b/i, /^sent — the campaign\b/i);
}

function awaitingKind(messages: Array<{ role: string; content: string }>, confirm: RegExp, sent: RegExp) {
  const recent = turnsSinceLastCommand(messages);
  const confirmAt = recent.findIndex((content) => confirm.test(content));
  if (confirmAt === -1) return false;
  const newer = recent.slice(0, confirmAt).some((content) => /just to confirm:/i.test(content));
  if (newer) return false;
  const sentAt = recent.findIndex((content) => sent.test(content));
  return sentAt === -1 || sentAt > confirmAt;
}

export function newsletterAwaitingYes(messages: Array<{ role: string; content: string }>) {
  return awaitingKind(messages, /just to confirm: send the newsletter\b/i, /^sent — the newsletter\b/i);
}

const TASK_PATTERNS: RegExp[] = [
  /\b(?:create|write|make|prepare|draft|send|build)\b[^.?!;\n]{0,48}\bnewsletters?\b|\bnewsletters?\b/gi,
  /\b(?:create|write|make|prepare|draft|send)\b[^.?!;\n]{0,40}\be-?letters?\b|\be-?letters?\b|\b(?:write|send|draft|prepare)\b[^.?!;\n]{0,24}\b(?:a\s+)?(?:letter|note)\b/gi,
  /\b(?:send|run|start|launch)\b[^.?!;\n]{0,48}\b(?:drip\s+campaigns?|campaigns?|drips?)\b|\bdrip\s+campaigns?\b|\bdrips?\b/gi,
  /\b(?:send|give|mail)\b[^.?!;\n]{0,80}\b(?:e-?cards?|greeting\s+cards?|(?:thank(?:\s+you)?|thanks|birthday|holiday|welcome|halloween|anniversary|norooz|nowruz)\s+cards?|(?:season'?s?|seasons|seasonal)\s+greetings?|holiday\s+greetings?|thank(?:\s+you)?|thanks|birthday|halloween|holidays?)\b|\be-?cards?\b|\bgreeting\s+cards?\b|\b(?:season'?s?|seasons|seasonal)\s+greetings?\b/gi,
  /\b(?:book|schedule|set\s+up)\b[^.?!;\n]{0,40}\b(?:zoom(?:\s+meeting)?|meeting)\b|\bzoom\s+meetings?\b/gi,
  /\b(?:show|see|read|check|open|what(?:'s| is)|list)\b[^.?!;\n]{0,40}\b(?:calendars?|schedule|agenda|meetings?)\b|\b(?:my|the)\s+calendar\b/gi,
  /\b(?:read|check|show|open|any|new)\b[^.?!;\n]{0,28}\b(?:e-?mails?|inbox|mailbox)\b/gi,
  /\b(?:who needs|who should i|who do i|which clients? (?:need|needs|are due|is due|should)|who is due|cross-?sell|upsell|not contacted|kyc due|needs attention|review (?:my |the )?clients|clients? (?:need|needs) (?:a )?review|due (?:for|to) (?:a )?(?:review|contact)|hasn'?t been contacted|have not been contacted)\b/gi,
  /\b(?:what products|products does|product history|tell me about|what do we know|open the file|client file|history of|pull up)\b/gi,
];

export function splitSecretaryTasks(text: string) {
  const tidy = tidyHeard(text).replace(/\bseznd\b/gi, "send");
  const hits: Array<{ index: number; end: number; pattern: number }> = [];
  for (let patternIndex = 0; patternIndex < TASK_PATTERNS.length; patternIndex += 1) {
    const pattern = TASK_PATTERNS[patternIndex];
    const re = new RegExp(pattern.source, pattern.flags);
    for (const match of tidy.matchAll(re)) {
      const index = match.index ?? 0;
      hits.push({ index, end: index + match[0].length, pattern: patternIndex });
    }
  }
  hits.sort((left, right) => left.index - right.index || right.end - left.end);
  const kept: typeof hits = [];
  for (const hit of hits) {
    const previous = kept[kept.length - 1];
    if (previous && hit.index < previous.end) continue;
    if (previous && hit.pattern === previous.pattern) {
      const between = tidy.slice(previous.end, hit.index);
      if (!/\b(?:then|also|plus|next)\b/i.test(between)) continue;
    }
    kept.push(hit);
  }
  if (kept.length <= 1) return [text];
  const slices: string[] = [];
  for (let index = 0; index < kept.length; index += 1) {
    const start = kept[index].index;
    const end = index + 1 < kept.length ? kept[index + 1].index : tidy.length;
    const slice = tidy.slice(start, end).replace(/[,;]?\s*(?:and|then|also|plus)\s*$/i, "").replace(/^[,;.\s]+/, "").trim();
    if (slice.length > 2) slices.push(slice);
  }
  return slices.length > 1 ? slices : [text];
}

export function taskKind(text: string) {
  const tidy = tidyHeard(text);
  if (isOnboardingDemo(tidy)) return "onboarding";
  if (isNewsletterAsk(tidy)) return "newsletter";
  if (isEletterAsk(tidy)) return "e-letter";
  if (isCampaignAsk(tidy)) return "campaign";
  if (isCardAsk(tidy)) return "e-card";
  if (isZoomAsk(tidy)) return "meeting";
  if (isCalendarAsk(tidy)) return "calendar";
  if (isInboxAsk(tidy)) return "inbox";
  if (isReviewAsk(tidy)) return "review";
  if (isFileAsk(tidy)) return "file";
  return "";
}

export type TurnRoute = "edit" | "plan" | "resume" | "revise" | "compose" | "appointment" | "calendar" | "cancel" | "confirm" | "desk" | "model";

export function decideTurn(text: string, lastAssistant = ""): TurnRoute {
  const tidy = tidyHeard(text);
  if (isTextEdit(tidy)) return "edit";
  if (asksForPlan(tidy)) return "plan";
  if (asksToResume(tidy)) return "resume";
  if (isRevisionAsk(tidy)) return "revise";
  if ((isTaskSwitch(tidy) || isStandaloneDraft(tidy)) && !refersToAppointment(tidy)) return "compose";
  if (refersToAppointment(tidy) && !isCalendarAsk(tidy)) return "appointment";
  if (isCalendarAsk(tidy)) return "calendar";
  if (isCancellation(tidy) && pendingQuestion(lastAssistant)) return "cancel";
  if ((agreesToSendCard(tidy) || isTimeAgreement(tidy)) && pendingQuestion(lastAssistant) === "confirm") return "confirm";
  if (taskKind(tidy)) return "desk";
  return "model";
}

export function toolsAllowed(text: string) {
  const tidy = tidyHeard(text);
  if (blocksLookup(tidy) || /\bdo not use any tools\b/i.test(tidy)) return false;
  if ((isTextEdit(tidy) || isRevisionAsk(tidy) || refersToAppointment(tidy)) && !isCalendarAsk(tidy)) return false;
  return true;
}

export function campaignAudience(text: string) {
  const names = newsletterRecipients(text);
  if (names.length > 0) return { names, tag: "" };
  const tagged = tidyHeard(text).match(/\b(?:for|to)\s+(?:the\s+|my\s+)?([a-z0-9][a-z0-9 &'’-]{1,40}?)\s+clients\b/i);
  if (tagged) return { names: [] as string[], tag: `${tagged[1]} clients`.replace(/\s+/g, " ").trim() };
  if (/\b(?:everyone|all contacts|all clients)\b/i.test(text)) return { names: ["everyone"], tag: "" };
  return { names: [] as string[], tag: "" };
}

export function batchAwaitingYes(messages: Array<{ role: string; content: string }>) {
  return awaitingKind(messages, /say yes and i will send all of these/i, /sent — the\b/i);
}
