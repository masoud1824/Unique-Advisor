import { hasMeetingWhen, isTimeAgreement } from "./meeting-time.ts";
import { refersToAppointment } from "./calendar-span.ts";
import { contentHoldKind, deliveryRequested, withoutNegatedDelivery } from "./workspace-policy.ts";
import { asksArchiveSearch, asksContactRecord, namedPeople } from "./delivery-audience.ts";
import { contactDeliveryBlock } from "./desk-workflows.ts";
import { isSignatureAsk } from "./signature-request.ts";

export { isSignatureAsk };

const SKIP = new Set(["a", "an", "the", "thank", "you", "thanks", "card", "cards", "ecard", "ecards", "please", "send", "to", "with", "for", "zoom", "meeting", "book", "booked", "look", "at", "massage", "message", "and", "give", "greeting", "greetings", "birthday", "holiday", "holidays", "welcome", "halloween", "season", "seasons", "seasonal", "anniversary", "norooz", "nowruz"]);

export function tidyHeard(text: string) {
  return text
    .replace(/\b(?:massage|message)\s+to\b/gi, "to")
    .replace(/\blook\s+at\b(?!\s+(?:the\s+|a\s+|an\s+)?(?:saved|stored|actual|existing|open|current|messages?|articles?|records?|contacts?|archive|newsletter|issues?|copies|drip|campaign|letter|note))/gi, "book a")
    .replace(/\bbooked\s+a\b/gi, "book a")
    .replace(/\bbook\s+at\b/gi, "book a")
    .replace(/\s+/g, " ")
    .trim();
}

function writtenCard(tidy: string) {
  return /\b(?:e-?cards?|greeting\s+cards?)\b/i.test(tidy) || (/\bcards?\b/i.test(tidy) && /\b(?:send|give|mail)\b/i.test(tidy));
}

function occasionCard(tidy: string) {
  if (/\b(?:e-?letters?|newsletters?|letters?|notes?|emails?|drips?|campaigns?)\b/i.test(tidy) && !/\bcards?\b/i.test(tidy)) return false;
  if (/\b(?:season'?s?|seasons|seasonal)\s+greetings?\b/i.test(tidy)) return true;
  if (/\bholiday\s+greetings?\b/i.test(tidy)) return true;
  const allowed = withoutNegatedDelivery(tidy);
  const occasion = /\b(?:thank(?:\s+you)?|thanks|birthday|halloween|welcome|anniversary|norooz|nowruz|holidays?)\b/i.test(allowed);
  if (!occasion) return false;
  if (/\b(?:send|give|mail)\b/i.test(allowed)) return true;
  return /^(?:please\s+)?(?:a\s+|an\s+|the\s+)?(?:thank(?:\s+you)?|thanks|birthday(?:\s+wishes)?|halloween|welcome|anniversary|(?:happy\s+)?holidays?|norooz|nowruz)(?:\s+to\s+\p{L}.+)?[.!?]?$/iu.test(tidy);
}

export function isCardAsk(text: string) {
  const tidy = tidyHeard(text);
  if (ordinaryBlocked(tidy)) return false;
  if (writtenCard(tidy)) return true;
  if (/\bgreeting\b/i.test(tidy) && /\b(?:for|to)\b/i.test(tidy)) return true;
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

export function isDropboxListAsk(text: string) {
  const tidy = tidyHeard(text);
  if (!/\bdropbox\b/i.test(tidy)) return false;
  if (/\b(?:upload|save|send|delete|move|sign)\b/i.test(tidy)) return false;
  return /\b(?:files?|folders?|list|show|what(?:'s| is)|open|see)\b/i.test(tidy);
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
      if ((plain === "example" || plain === "sample") && words.length > 0) words.push(raw);
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

const TRAILING_NAME = new Set(["instead", "please", "now", "thanks", "again", "only"]);

function cleanPerson(name: string) {
  const words = String(name || "").split(/\s+/).filter((word) => word && !TRAILING_NAME.has(word.toLowerCase()));
  return words.slice(0, 3).join(" ");
}

function uniquePeople(names: string[]) {
  const kept: string[] = [];
  for (const name of names) {
    const tidy = cleanPerson(name);
    if (tidy.length < 2) continue;
    if (kept.some((item) => item.toLowerCase() === tidy.toLowerCase())) continue;
    kept.push(tidy);
  }
  return kept;
}

function isStopClause(clause: string) {
  const tidy = clause.replace(/[.!?؟]+$/g, "").trim();
  if (!tidy) return false;
  if (/^(?:please\s+)?(?:stop|cancel|never\s?mind|nevermind)$/i.test(tidy)) return true;
  if (/^(?:please\s+)?(?:do not|don't|never)\s+send(?:\s+it)?$/i.test(tidy)) return true;
  return /^(?:لطفا\s*)?(?:لغو کن|لغو|کنسل|ارسال نکن|نفرستید|استاپ)$/u.test(tidy);
}

function looksLikePerson(name: string) {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  if (words.some((word) => /^(?:email|recipient|preview|card|send|sending|missing|explain|only|newsletter|letter|drip|show|the|or|and|if|it|is)$/i.test(word))) return false;
  return words.every((word) => /^[\p{L}'’-]+$/u.test(word));
}

function namesInClause(clause: string) {
  if (isStopClause(clause)) return [];
  const proper = namedPeople(clause);
  if (proper.length) return uniquePeople(proper);
  if (isAlternativeClause(clause) && !/\b(?:to|for)\b/i.test(clause)) return [];
  const one = cleanPerson(contactPhrase(clause));
  if (one.length >= 2 && looksLikePerson(one) && !/^(?:yes|yeah|yep|yup|ok|okay|stop|cancel|please)$/i.test(one)) return [one];
  return [];
}

function isBareDoNotSend(clause: string) {
  const tidy = clause.replace(/[.!?؟]+$/g, "").trim();
  if (/^(?:please\s+)?(?:do not|don't|never)\s+send(?:\s+(?:it|anything|this|that))?$/i.test(tidy)) return true;
  return /^(?:لطفا\s*)?(?:نفرست|ارسال نکن|نفرستید)$/u.test(tidy);
}

function isPreviewRequest(text: string) {
  return /\b(?:preview|show|display|rehearse)\b/i.test(tidyHeard(text));
}

function isAlternativeClause(clause: string) {
  return /\b(?:or|either|versus|vs\.?|which)\b/i.test(clause) || /یا/.test(clause);
}

function coordinatedNames(clause: string, names: string[]) {
  if (names.length < 2 || isAlternativeClause(clause)) return false;
  return /\band\b|,|،/i.test(clause) || /\sو\s/u.test(clause);
}

/** "A and B" is one audience. "A or B", or several names with no join, is a choice. */
export function coordinatedAudience(text: string): { mode: "all" | "choice" | "one" | "none"; names: string[] } {
  const people = namedPeople(String(text || ""));
  if (people.length === 0) return { mode: "none", names: [] };
  if (people.length === 1) return { mode: "one", names: people };
  if (isAlternativeClause(text)) return { mode: "choice", names: people };
  if (/\band\b|,|،/i.test(text) || /\sو\s/u.test(text)) return { mode: "all", names: people };
  return { mode: "choice", names: people };
}

export function audienceChoiceReply(names: string[]) {
  const who = names.map((name) => String(name || "").trim()).filter(Boolean);
  const first = who[0] || "one of them";
  return `Did you mean ${who.join(" or ")}? I did not choose ${first}. Nothing was sent.`;
}

function deliveryConstraint(clause: string) {
  if (isBareDoNotSend(clause)) return true;
  return /\b(?:preview|show|display|rehearse)\b/i.test(clause) && /\b(?:do not|don't|never)\s+send\b/i.test(clause);
}

function clauseIntent(clause: string, preview = false) {
  if (preview && deliveryConstraint(clause)) {
    return { stop: false, names: isBareDoNotSend(clause) ? [] as string[] : namesInClause(clause) };
  }
  if (isStopClause(clause)) return { stop: true, names: [] as string[] };
  const names = namesInClause(clause);
  if (isBareDoNotSend(clause)) return { stop: true, names };
  const refusal = /\b(?:do not|don't|never)\s+send\b/i.test(clause);
  if (refusal) return { stop: true, names };
  return { stop: false, names };
}

function cardClauses(text: string) {
  let tidy = tidyHeard(text);
  if (isCardAsk(tidy) || /\b(?:e-?card|birthday)\b/i.test(tidy)) {
    tidy = tidy.replace(/\s+[—–]\s+/g, ". ").replace(/\s+-\s+/g, ". ");
    tidy = tidy.replace(/\s+\b(stop|cancel|never mind|nevermind)\b/gi, ". $1");
  }
  return tidy.split(/[.!?؟]+/).map((clause) => clause.trim()).filter(Boolean);
}

export type CardCorrection =
  | { kind: "use"; name: string; dropped: string }
  | { kind: "all"; names: string[] }
  | { kind: "cancelled"; dropped: string; reply: string }
  | { kind: "ambiguous"; names: string[]; reply: string };

/**
 * A later recipient replaces an earlier one after stop/cancel.
 * "A and B" prepares both. "A or B", or two send clauses with no stop, stays a choice.
 * One recipient and no stop returns null so contactPhrase stays in charge.
 * A trailing "Do not send" on a preview is a delivery constraint, not a cancellation.
 * The first-name helper is unchanged: it still stops at the first "to".
 */
export function resolveCardCorrection(text: string): CardCorrection | null {
  const clauses = cardClauses(text);
  const preview = isPreviewRequest(text);
  const cardish = isCardAsk(text) || clauses.some((clause) => isCardAsk(clause)) || (preview && /\b(?:e-?cards?|thank(?:\s+you)?|birthday|holiday|welcome|anniversary)\s+cards?\b/i.test(text));
  if (!cardish) return null;
  const pieces = clauses.map((clause) => clauseIntent(clause, preview));
  const stopped = pieces.some((piece) => piece.stop);
  const everyone = uniquePeople(pieces.flatMap((piece) => piece.names));
  const together = !stopped && everyone.length > 1 && clauses.some((clause) => coordinatedNames(clause, namesInClause(clause)));
  if (together && !clauses.some((clause) => isAlternativeClause(clause) && namesInClause(clause).length > 1)) {
    return { kind: "all", names: everyone };
  }
  if (!stopped && everyone.length <= 1) return null;
  if (!stopped) {
    return {
      kind: "ambiguous",
      names: everyone,
      reply: `Did you mean ${everyone.join(" or ")}? I did not choose ${everyone[0]}. Nothing was sent.`,
    };
  }
  let dropped: string[] = [];
  let current: string[] = [];
  for (const piece of pieces) {
    if (piece.stop) {
      dropped = dropped.concat(current, piece.names);
      current = [];
      continue;
    }
    if (piece.names.length) {
      dropped = dropped.concat(current);
      current = piece.names;
    }
  }
  if (current.length > 1 && clauses.some((clause) => coordinatedNames(clause, namesInClause(clause)))) {
    return { kind: "all", names: uniquePeople(current) };
  }
  if (current.length > 1) {
    return {
      kind: "ambiguous",
      names: current,
      reply: `Did you mean ${current.join(" or ")}? I did not keep an earlier name. Nothing was sent.`,
    };
  }
  if (current.length === 0) {
    const prior = uniquePeople(dropped);
    const last = prior[prior.length - 1] || "";
    return {
      kind: "cancelled",
      dropped: last,
      reply: last ? `I cancelled the request for ${last}. Nothing was sent.` : "Cancelled. Nothing was sent.",
    };
  }
  const name = current[0];
  const prior = uniquePeople(dropped).filter((item) => item.toLowerCase() !== name.toLowerCase());
  return { kind: "use", name, dropped: prior[prior.length - 1] || "" };
}

export function keepCardCorrection(text: string) {
  const fix = resolveCardCorrection(text);
  return fix?.kind === "use" || fix?.kind === "all" || fix?.kind === "ambiguous";
}

/** Recipient named with to/for. A bare yes has none. */
export function recipientAfterDirection(text: string) {
  const tidy = tidyHeard(text);
  const found = tidy.match(/\b(?:to|for)\s+([^.?!]+)/i);
  if (!found) return "";
  return namesInClause(`to ${found[1]}`)[0] || "";
}

export function blockedRecipientReply(name: string, tags: string, email: string, dropped = "") {
  const reason = contactDeliveryBlock(tags, email);
  if (!reason) return "";
  const who = String(name || "").trim() || "That contact";
  const earlier = dropped && dropped.toLowerCase() !== who.toLowerCase() ? ` I cancelled the request for ${dropped}.` : "";
  return `${who} — ${reason}.${earlier} Nothing was sent.`;
}

/** A cancelled recipient withdraws only previews that name that person. */
export function summaryMentionsPerson(summary: string, person: string) {
  const name = String(person || "").trim().toLowerCase();
  if (name.length < 2) return false;
  return String(summary || "").toLowerCase().includes(name);
}

export function cardIdentityQuestion(lastAssistant: string) {
  const last = String(lastAssistant || "");
  if (/just to confirm:/i.test(last)) return null;
  if (!/did you mean\b/i.test(last) || !/\bcard\b/i.test(last)) return null;
  const titles = [...last.matchAll(/\bthe (.+?) card\b/gi)].map((match) => match[1].trim()).filter(Boolean);
  const unique = [...new Set(titles)];
  if (!unique.length) return null;
  const name = last.match(/\bfor ([^?\n]+)\?/i)?.[1]?.trim() || "";
  return { titles: unique, name };
}

export type IdentityAnswer =
  | { kind: "not-identity" }
  | { kind: "unclear" }
  | { kind: "accept"; title: string; name: string }
  | { kind: "change"; title: string; name: string; previous: string };

/** Yes to "Did you mean this card for this person?" is not permission to send. */
export function interpretIdentityAnswer(userText: string, lastAssistant: string): IdentityAnswer {
  const identity = cardIdentityQuestion(lastAssistant);
  if (!identity) return { kind: "not-identity" };
  const tidy = tidyHeard(userText);
  if (!tidy || declinesCard(tidy) || isBareRefusal(tidy)) return { kind: "not-identity" };
  if (!agreesToSendCard(tidy) && !isTimeAgreement(tidy)) return { kind: "unclear" };
  if (identity.titles.length !== 1) return { kind: "unclear" };
  const named = recipientAfterDirection(tidy);
  const title = identity.titles[0];
  if (named && identity.name && named.toLowerCase() !== identity.name.toLowerCase()) {
    return { kind: "change", title, name: named, previous: identity.name };
  }
  if (!identity.name && !named) return { kind: "unclear" };
  return { kind: "accept", title, name: identity.name || named };
}

/** Sidebar title is the first message, clipped. The clock is a separate stamp. */
export function assistantChatTitle(content: string) {
  return String(content || "").slice(0, 42);
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
  if (!(askingCard && tidy.length <= 80) && taskKind(tidy) && !agreesToSendCard(tidy) && !declinesCard(tidy) && !isNewsletterEdit(tidy)) return false;
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
  const tidy = tidyHeard(text).replace(/\b(?:do not|don't|never|without)\b[^.!?]*/gi, " ");
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
  if (isCalendarAsk(tidy)) return false;
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
  if (!realApproval(previousReply)) return false;
  if (isRevisionAsk(tidy) || isCancellation(tidy) || shouldIgnorePending(tidy, previousReply)) return false;
  if (taskKind(tidy)) return false;
  if (/\b(?:show|list|read|who|what|which|find|contacts?)\b/i.test(tidy) || /مخاطب|نشان بده|لیست/.test(tidy)) return false;
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

function ordinaryBlocked(text: string) {
  if (/\b(?:rewrite|revise|reword|shorten|condense|translate|rephrase|remove|delete)\b/i.test(text)) return true;
  if (/\b(?:do not|don't|never)\s+(?:create|write|draft)\b/i.test(text)) return true;
  if (/\b(?:do not|don't|never)\s+(?:send|mail|email)\b/i.test(text)) {
    const before = text.split(/\b(?:do not|don't|never)\s+(?:send|mail|email)\b/i)[0] || "";
    return !/\b(?:draft|write|prepare|preview|compose|greeting|show|make)\b/i.test(before);
  }
  return false;
}

/** The request asks for a draft and also says not to send it. */
export function holdsDelivery(text: string) {
  return /\b(?:do not|don't|never)\s+(?:send|mail|email)\b/i.test(tidyHeard(text));
}

/** On-screen greeting. A missing mailbox does not block this, and nothing is sent. */
export function greetingDraft(text: string, savedMessage = "") {
  const name = contactPhrase(text) || "there";
  const title = cardTitleHint(text) || "Greeting";
  const saved = String(savedMessage || "").replace(/\s+/g, " ").trim();
  const body = saved || (/\bbirthday\b/i.test(text)
    ? `Happy birthday, ${name}. Wishing you a good year ahead.`
    : `Hello ${name}.`);
  return `${title} for ${name}. Nothing was sent.\n\n${body}`;
}

export function isNewsletterArticleAdd(text: string) {
  const tidy = tidyHeard(text);
  if (!/\badd\b/i.test(tidy)) return false;
  if (suppliedArticle(tidy)) return true;
  return /\b(?:one more|another|extra|new|an|a)\s+article\b/i.test(tidy)
    || /\b(?:first|second|third|fourth|fifth|sixth|\d+(?:st|nd|rd|th)?)\s+article\b/i.test(tidy);
}

/** Title and body written in the request. Null when the request does not supply both. */
export function suppliedArticle(text: string) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const titleMatch = raw.match(/\btitle\s*:\s*(.+?)(?=\s+body\s*:|$)/i);
  const bodyMatch = raw.match(/\bbody\s*:\s*(.+?)(?=\s+\b(?:save|keep|show|do not|don't|preview)\b|$)/i);
  if (!titleMatch || !bodyMatch) return null;
  const title = titleMatch[1].replace(/[.]+$/g, "").trim();
  const body = bodyMatch[1].trim();
  if (title.length < 2 || body.length < 2) return null;
  return { title, body };
}

/** Every person named on a card preview, such as “for Casey Sample and Riley Sample”. */
export function namedPreviewRecipients(text: string) {
  const raw = String(text || "");
  if (!/\b(?:e-?cards?|cards?|preview)\b/i.test(raw)) return [];
  return namedPeople(raw);
}

/** A person named on a card preview, such as “for Casey Sample only”. */
export function namedPreviewRecipient(text: string) {
  return namedPreviewRecipients(text)[0] || "";
}

export function addedArticleTopic(text: string) {
  const tidy = tidyHeard(text);
  const about = tidy.match(/\babout\s+(.+?)[.?!]?$/i);
  return about ? about[1].replace(/^(?:a|an|the)\s+/i, "").replace(/[.?!]+$/g, "").trim() : "";
}

export function isNewsletterDelivery(text: string) {
  const tidy = tidyHeard(withoutNegatedDelivery(text));
  return /\b(?:send|email|deliver)\b/i.test(tidy) || /\bmail\s+(?:it|this|the|a|an|him|her|them)\b/i.test(tidy);
}

export function isNewsletterReorder(text: string) {
  const tidy = tidyHeard(text);
  if (/\b(?:move|bring|shift)\s+(?:it|that|this)\s+(?:up|down)\b/i.test(tidy)) return true;
  return /\b(?:reorder|rearrange|move|put|place)\b/i.test(tidy) && /\b(?:articles?|parts?|sections?|positions?|newsletters?|up|down)\b/i.test(tidy);
}

export function newsletterMoveTarget(text: string) {
  const tidy = tidyHeard(text);
  const words = ["first", "second", "third", "fourth", "fifth", "sixth"];
  const numbered = tidy.match(/\b(?:to|into|as)\s+(?:the\s+)?(?:position\s+|spot\s+|place\s+)?(\d+)\b/i);
  const named = tidy.match(/\b(?:to|into|as)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth)\b/i);
  const to = numbered ? Number(numbered[1]) - 1 : named ? words.indexOf(named[1].toLowerCase()) : null;
  const quoted = tidy.match(/[“"]([^"”]{2,80})[”"]/);
  const source = tidy.match(/\b(?:move|put|place)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|\d+(?:st|nd|rd|th)?)\s+(?:article|part|section)\b/i);
  const sourceWord = source?.[1]?.toLowerCase() || "";
  const sourceIndex = source ? words.includes(sourceWord) ? words.indexOf(sourceWord) : Math.max(0, Number(sourceWord.replace(/\D/g, "")) - 1) : null;
  let name = quoted?.[1]?.replace(/[,.]+$/g, "").trim() || "";
  if (!name) {
    const bare = tidy.match(/\b(?:move|put|place|bring)\s+(?:the\s+)?(.+?)\s+(?:to|into|as)\s+(?:the\s+)?(?:position|spot|place|first|second|third|fourth|fifth|sixth|\d)/i);
    const candidate = String(bare?.[1] || "").replace(/^(?:article|part|section)\s+/i, "").replace(/[,.]+$/g, "").trim();
    if (candidate && !/^(?:it|that|this|article|part|section)$/i.test(candidate) && !/^(?:first|second|third|fourth|fifth|sixth|\d+(?:st|nd|rd|th)?)(?:\s+(?:article|part|section))?$/i.test(candidate)) name = candidate;
  }
  const relative = /\b(?:up one|move it up)\b/i.test(tidy) || /\b(?:move|bring|shift)\s+(?:it|that|this)\s+up\b/i.test(tidy)
    ? -1
    : /\b(?:down one|move it down)\b/i.test(tidy) || /\b(?:move|bring|shift)\s+(?:it|that|this)\s+down\b/i.test(tidy)
      ? 1
      : 0;
  return { name, to, sourceIndex, relative };
}

export function isNewsletterArticleRevision(text: string) {
  const tidy = tidyHeard(text);
  if (!/\b(?:shorten|condense|rewrite|reword|rephrase|trim)\b/i.test(tidy)) return false;
  if (/\b(?:article|part|section|story)\b/i.test(tidy)) return true;
  if (!/\bto\s+(?:\d+|one|two|three|four|a|an|single)\s+sentences?\b/i.test(tidy)) return false;
  if (/\b(?:e-?cards?|thank you|birthday|holiday|welcome|anniversary)\b/i.test(tidy) && !/\bnewsletters?\b/i.test(tidy)) return false;
  return /\b(?:newsletters?|saved copy)\b/i.test(tidy) || Boolean(newsletterArticleTarget(tidy).name);
}

export function newsletterArticleTarget(text: string) {
  const tidy = tidyHeard(text);
  const words = ["first", "second", "third", "fourth", "fifth", "sixth"];
  const specific = tidy.match(/\b(first|second|third|fourth|fifth|sixth)\s+(?:article|part|section|story)\b/i)
    || tidy.match(/\b(?:article|part|section|story)\s+(first|second|third|fourth|fifth|sixth)\b/i);
  const numbered = tidy.match(/\b(?:article|part|section|story)\s+#?\s*(\d+)\b/i)
    || tidy.match(/\b(\d+)(?:st|nd|rd|th)?\s+(?:article|part|section|story)\b/i);
  const index = specific ? words.indexOf(specific[1].toLowerCase()) : numbered ? Math.max(0, Number(numbered[1]) - 1) : null;
  const quoted = tidy.match(/[“"]([^"”]{2,80})[”"]/);
  const titled = tidy.match(/\b(?:titled|called|named)\s+([^.,]{2,80})/i);
  const loose = tidy.match(/\b(?:article|part|section|story)\s+#?\s*\d+\s*[,:\-–—]?\s+([A-Za-z][^.\n]{2,80})/i);
  const name = (quoted?.[1] || titled?.[1] || loose?.[1] || "")
    .replace(/\s+\b(?:to|into|down to|so it|so that|keep|leave|do not|don't|and show|show the)\b[\s\S]*$/i, "")
    .replace(/[,.]+$/g, "")
    .trim();
  const shortened = !name
    ? tidy.match(/\b(?:shorten|condense|rewrite|reword|rephrase|trim)\s+(?:only\s+)?(?:the\s+)?(.+?)\s+(?:down\s+)?to\s+(?:\d+|one|two|three|four|a|an|single)\s+sentences?\b/i)
    : null;
  const shortenedName = String(shortened?.[1] || "")
    .replace(/^(?:article|part|section|story)\s+(?:#?\s*\d+\s*[,:\-–—]?\s*)?/i, "")
    .replace(/^(?:first|second|third|fourth|fifth|sixth)\s+/i, "")
    .replace(/[,.]+$/g, "")
    .trim();
  const resolvedName = name || (/^(?:it|that|this|article|part|section|story)$/i.test(shortenedName) ? "" : shortenedName);
  const count = tidy.match(/\b(\d+|one|two|three|four|a|an|single)\s+sentences?\b/i);
  const wordCount: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, a: 1, an: 1, single: 1 };
  const sentences = count ? wordCount[count[1].toLowerCase()] || Number(count[1]) : null;
  return { index, name: resolvedName, sentences };
}

export function sentenceCount(text: string) {
  return String(text || "").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean).length;
}

export function firstSentences(text: string, count: number) {
  const parts = String(text || "").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  return parts.slice(0, Math.max(1, count)).join(" ");
}

export function isNewsletterEdit(text: string) {
  const tidy = tidyHeard(text);
  if (!/\b(?:remove|drop|delete|cut|take out)\b/i.test(tidy)) return false;
  return /\b(?:newsletter|article|part|section|story|paragraph)\b/i.test(tidy);
}

export function isNewsletterHold(text: string) {
  const tidy = tidyHeard(text);
  if (asksArchiveSearch(tidy)) return false;
  if (isNewsletterDelivery(tidy)) return false;
  if (isNewsletterArticleAdd(tidy) || isNewsletterArticleRevision(tidy) || isNewsletterEdit(tidy) || isNewsletterReorder(tidy)) return true;
  return /\bnewsletters?\b/i.test(tidy) && /\b(?:preview|show|save|archive|reopen|open|display|view)\b/i.test(tidy);
}

export function isNewsletterArchiveAsk(text: string) {
  const tidy = tidyHeard(text);
  if (!/\bnewsletters?\b/i.test(tidy)) return false;
  const hold = /\b(?:do not|don't|without|never)\s+send\b/i.test(tidy) || /\bnewsletter archive\b/i.test(tidy) || /\bsave it\b/i.test(tidy);
  const make = /\b(?:create|draft|write|prepare|preview|show|archive|save)\b/i.test(tidy);
  return hold && make;
}

export function newsletterArchiveTopics(text: string) {
  const tidy = tidyHeard(text);
  const listed = tidy.match(/\barticles?\s*:\s*([^.]*)/i)?.[1] || "";
  const topics = listed
    .split(/\s*,\s*|\s+\band\b\s+/i)
    .map((part) => part.replace(/^(?:and|or)\s+/i, "").replace(/^(?:a|an|the)\s+/i, "").replace(/[.?!]+$/g, "").trim())
    .filter((part) => part.length > 2 && !/^(?:articles?|stories|story)$/i.test(part));
  if (topics.length > 0) return topics.slice(0, 8);
  return newsletterTopics(tidy.replace(/\b(?:do not|don't|never|without)\s+send\b[\s\S]*$/i, ""));
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
  if (isNewsletterArchiveAsk(tidy)) return true;
  if (ordinaryBlocked(tidy) || isNewsletterEdit(tidy) || isNewsletterHold(tidy) || isNewsletterArticleRevision(tidy) || isNewsletterReorder(tidy)) return false;
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
  const audience = coordinatedAudience(tidy);
  if (audience.mode === "choice") return [];
  if (audience.names.length > 1) return audience.names;
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
  if (ordinaryBlocked(tidy) || isNewsletterAsk(tidy) || isCardAsk(tidy) || isCampaignAsk(tidy) || isStandaloneDraft(tidy)) return false;
  if (/\be-?letters?\b/i.test(tidy) && /\b(?:create|write|make|prepare|draft|send)\b/i.test(tidy)) return true;
  return /\b(?:write|send|draft|prepare)\b/i.test(tidy) && /\b(?:a\s+)?(?:letter|note|email)\b/i.test(tidy) && /\bto\b/i.test(tidy);
}

const LETTER_STOP = /\s+\b(?:and|to|that|about|regarding|tell|telling|saying|say|ask|asking|request|requesting|invite|inviting)\b/i;

export function eletterRecipient(text: string) {
  const people = eletterRecipients(text);
  return people[0] || "";
}

/** Every person joined by and. "or" stays unresolved so the caller can ask. */
export function eletterRecipients(text: string) {
  const tidy = tidyHeard(text);
  const audience = coordinatedAudience(tidy);
  if (audience.mode === "choice") return [];
  if (audience.names.length > 1) return audience.names;
  const found = tidy.match(/\b(?:e-?letter|letter|note|email)\s+to\s+(.+)/i);
  if (!found) return [];
  const chunk = found[1].split(LETTER_STOP)[0] || "";
  const one = chunk.replace(/[.?!]+$/g, "").replace(/^(?:please\s+)/i, "").trim();
  return one ? [one] : [];
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
  if (!deliveryRequested(tidy)) return false;
  return /\b(?:drips?|campaigns?)\b/i.test(tidy);
}

export function isInboxAsk(text: string) {
  const tidy = tidyHeard(text);
  if (blocksLookup(tidy) || isTextEdit(tidy) || isCardAsk(tidy) || isNewsletterAsk(tidy) || isEletterAsk(tidy)) return false;
  if (asksContactRecord(tidy)) return false;
  if (namedPeople(tidy).length && /\bcontacts?\b/i.test(tidy) && !/\b(?:inbox|mailbox)\b/i.test(tidy)) return false;
  if (/\b(?:including|include|with)\b[^.]{0,40}\be-?mails?\b/i.test(tidy) && /\b(?:contacts?|tags?|record)\b/i.test(tidy)) return false;
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
  if (isNewsletterHold(tidy) || contentHoldKind(tidy) === "newsletter") return "newsletter";
  if (isOnboardingDemo(tidy)) return "onboarding";
  const held = contentHoldKind(tidy);
  if (held) return held;
  if (isSignatureAsk(tidy)) return "signature";
  if (isNewsletterAsk(tidy)) return "newsletter";
  if (isEletterAsk(tidy)) return "e-letter";
  if (isCampaignAsk(tidy)) return "campaign";
  if (isCardAsk(tidy)) return "e-card";
  if (isZoomAsk(tidy)) return "meeting";
  if (isCalendarAsk(tidy)) return "calendar";
  if (isFormAsk(tidy)) return "form";
  if (isClientFileAsk(tidy)) return "client-file";
  if (isInboxAsk(tidy)) return "inbox";
  if (isDropboxListAsk(tidy)) return "dropbox";
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

export function isFormAsk(text: string) {
  const tidy = tidyHeard(text);
  if (ordinaryBlocked(tidy) || isCalendarAsk(tidy)) return false;
  if (/\b(?:e-?mail|upload|signature|book)\b/i.test(tidy) && !/\b(?:find|search|get|open|look|need)\b/i.test(tidy)) return false;
  if (!/\b(?:forms?|applications?)\b/i.test(tidy)) return false;
  if (/\b(?:send|email)\b/i.test(tidy) && !/\b(?:find|search|get|open|look)\b/i.test(tidy)) return false;
  return /\b(?:find|search|get|open|look|need|where)\b/i.test(tidy)
    || /\b(?:useful links?|forms? library|insurer|carrier|canada life|manulife|sun life|assumption|empire life|ivari|equitable)\b/i.test(tidy);
}

export function isClientFileAsk(text: string) {
  const tidy = tidyHeard(text);
  if (ordinaryBlocked(tidy) || isCalendarAsk(tidy) || isFormAsk(tidy)) return false;
  if (/\b(?:client id|policy number|policy #)\b/i.test(tidy)) return true;
  if (!/\bdropbox\b/i.test(tidy)) return false;
  if (/\b(?:do not|don't|never|without|leave)\b[^.]{0,80}\bdropbox\b/i.test(tidy)) return false;
  if (/\bdropbox\b[^.]{0,40}\b(?:alone|untouched)\b/i.test(tidy)) return false;
  if (/(?:دست نزن|باز نکن|وصل نکن)/.test(tidy)) return false;
  return true;
}

export function isBareRefusal(text: string) {
  const tidy = tidyHeard(text);
  if (/\b(?:preview|show|save|change|shorten|move|open)\b/i.test(tidy) && tidy.split(/\s+/).length > 4) return false;
  if (/^(?:please\s+)?(?:do not|don't|never)\s+send[.!?]?$/i.test(tidy)) return true;
  if (/^(?:لطفا\s*)?(?:نفرست|ارسال نکن|نفرستید)[.!؟?\s]*$/u.test(tidy)) return true;
  return /^(?:please\s+)?(?:cancel|stop|never mind|nevermind)[.!?]?$/i.test(tidy);
}

export function replacesWithBookingRefusal(request: string, spoken: string) {
  if (isCalendarAsk(request)) return false;
  const text = String(spoken || "");
  if (!/\bbooked\b/i.test(text) || /\bnot booked\b/i.test(text)) return false;
  if (/\b(?:did not|didn't|do not|don't|never|without|was not|were not|wasn't|weren't|nothing)\b[\s\S]{0,48}\bbooked\b/i.test(text)) return false;
  return true;
}

export function isLetterParagraphEdit(text: string, lastAssistant = "") {
  const tidy = tidyHeard(text);
  const edits = /\b(?:change|replace|revise|rewrite|update|edit)\b/i.test(tidy);
  const namesParagraph = /\b(?:first|second|third|fourth)(?:\s+[a-z]+){0,3}\s+paragraph\b/i.test(tidy) || /\bparagraph\s+(?:one|two|three|four|[1-4])\b/i.test(tidy);
  if (!edits || !namesParagraph) return false;
  if (/\b(?:e-?letters?|letters?|notes?)\b/i.test(tidy) && !/\bnewsletter\b/i.test(tidy)) return true;
  return /preview of [“"][^"”]+[”"]/i.test(lastAssistant);
}

export function isCardMessageEdit(text: string, lastAssistant = "") {
  const raw = String(text || "");
  const tidy = tidyHeard(text);
  if (!/\b(?:change|replace|rewrite|update|edit|make)\b/i.test(`${raw}\n${tidy}`)) return false;
  if (!/\b(?:message|wording|note|text|caption|says|reads)\b/i.test(raw)) return false;
  if (/\b(?:e-?cards?|greetings?|thank you|birthday|holiday|welcome|anniversary)\b/i.test(`${raw}\n${tidy}`)) return true;
  return /preview of the .+ card/i.test(lastAssistant);
}

export function cardMessageReplacement(text: string) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const quoted = raw.match(/[“"]([^"”]{2,500})[”"]/);
  let message = quoted?.[1]?.trim() || "";
  if (!message) {
    const specific = raw.match(/\b(?:message|wording|text|caption)\s+(?:to|as|be|read|say)\s*:?\s*([\s\S]+)/i)
      || raw.match(/\b(?:so it reads|so it says|so that it says|so that it reads|should say|should read|now says|now reads|to say|to read)\s*:?\s*([\s\S]+)/i);
    message = String(specific?.[1] || "").trim();
  }
  if (!message) {
    const lead = raw.match(/\b(?:change|replace|rewrite|update|edit|make)\b[\s\S]{0,80}?\bto\s*:?\s+([\s\S]+)/i);
    message = String(lead?.[1] || "").trim();
  }
  message = message.replace(/^(?:say|read|be|become|the following:|this:)\s+/i, "");
  message = (message.split(/\b(?:keep|leave|don't|do not|without changing|the other|the rest|nothing else|and show|show the|preview|nothing was)\b/i)[0] || "").trim();
  message = message.replace(/\s+/g, " ").replace(/^[,:;\s]+/, "").replace(/[.!?]+$/g, "").trim();
  if (/\b(?:change|replace|revise|edit)\s+the\b/i.test(message)) return "";
  if (message.length < 2) return "";
  if (/^dear\b/i.test(message)) return message;
  return `Dear [Contact Name],\n\n${message}.`;
}

const STEP_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, first: 1, second: 2, third: 3, fourth: 4 };

/** A wait that belongs to one drip step, not the campaign-wide interval. Step 1 has no wait. */
export function campaignStepWait(text: string) {
  const tidy = tidyHeard(text);
  if (!/\b(?:after|wait|waits|waiting|only)\b/i.test(tidy)) return null;
  const days = tidy.match(/\b(\d+)\s+days?\b/i);
  if (!days) return null;
  if (/\bevery\s+(?:\d+\s+)?(?:days?|weeks?|months?)\b/i.test(tidy) && !/\bstep\b/i.test(tidy)) return null;
  const mentions = [...tidy.matchAll(/\b(?:step|article)\s+(?:#\s*)?(one|two|three|four|first|second|third|fourth|\d+)\b/gi)];
  if (!mentions.length) return null;
  const after = tidy.match(/\bafter\s+(?:step|article)\s+(?:#\s*)?(one|two|three|four|first|second|third|fourth|\d+)\b/i);
  const afterNumber = after ? STEP_WORDS[after[1].toLowerCase()] || Number(after[1]) : 0;
  const numbers = mentions.map((match) => STEP_WORDS[match[1].toLowerCase()] || Number(match[1])).filter((number) => number > 0);
  const target = numbers.find((number) => number !== afterNumber && number >= 2) || numbers.find((number) => number >= 2) || 0;
  if (!target) return null;
  return { step: target, days: Math.min(365, Math.max(1, Number(days[1]))) };
}

export function campaignIntervalDays(text: string) {
  const tidy = tidyHeard(text).toLowerCase();
  if (/\bevery other week\b|\bbi-?weekly\b|\bevery two weeks\b|\bevery 2 weeks\b/.test(tidy)) return 14;
  if (/\bweekly\b|\bevery week\b/.test(tidy)) return 7;
  if (/\bmonthly\b|\bevery month\b/.test(tidy)) return 30;
  if (/\bdaily\b|\bevery day\b/.test(tidy)) return 1;
  const every = tidy.match(/\bevery\s+(\d+)\s+days?\b/);
  if (every) return Math.min(365, Math.max(1, Number(every[1])));
  const days = tidy.match(/\b(\d+)\s+days?\b/);
  if (days && /\b(?:timing|interval|frequency|cadence|schedule|wait)\b/.test(tidy)) return Math.min(365, Math.max(1, Number(days[1])));
  return null;
}

export function isCampaignTimingEdit(text: string, lastAssistant = "") {
  if (campaignStepWait(text)) return false;
  if (!campaignIntervalDays(text)) return false;
  if (/\b(?:campaigns?|drips?|timing|interval|frequency|cadence)\b/i.test(text)) return true;
  return /nothing was started|not active|welcome drip|campaign/i.test(lastAssistant);
}
