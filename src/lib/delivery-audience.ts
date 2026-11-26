import { contactDeliveryBlock } from "./desk-workflows.ts";

export type AudienceRow = { name: string; email: string; tags: string };

const NOT_PEOPLE = new Set([
  "test newsletter",
  "retirement note",
  "welcome drip",
  "thank you",
  "unique advisor",
  "test office",
  "life insurance",
  "signature workflow",
  "signature workflow test",
  "november",
  "toronto",
  "acceptance welcome",
  "welcome",
  "royal plum",
]);

const NOT_TOKENS = new Set([
  "leave", "dropbox", "show", "read", "find", "look", "microsoft", "outlook",
  "unique", "advisor", "preview", "open", "search", "list", "please", "cancel",
  "keep", "give", "tell", "use", "make", "check", "monitor", "saved", "contact",
  "record", "source", "email", "mail", "signature", "workflow", "test", "office",
  "acceptance", "welcome", "drip", "retirement", "note", "thank", "you", "time",
  "value", "money", "november", "toronto", "isolated", "desk", "local", "locally",
  "life", "insurance", "client", "clients", "policy", "policies", "article",
  "articles", "newsletter", "newsletters", "copy", "copies", "archive", "archived",
  "meeting", "appointment", "minute", "minutes",
]);

const LEADING_WORDS = new Set([
  "pull", "show", "read", "find", "look", "preview", "open", "search", "list",
  "please", "give", "tell", "use", "make", "check", "get", "fetch", "bring",
  "display", "load", "view", "see", "for", "from", "with", "dear", "only",
  "and", "the",
]);

/** Every explicitly named person, not a document, product, or instruction. */
export function namedPeople(text: string) {
  const found = [...String(text || "").matchAll(/\b([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){1,3})\b/gu)];
  const names: string[] = [];
  for (const match of found) {
    const raw = match[1].replace(/\s+/g, " ").trim().replace(/(?:['’]s)+$/i, "");
    const words = raw.split(/\s+/).filter(Boolean);
    const tokens = words.map((part) => part.toLowerCase().replace(/[^a-z]/g, ""));
    let start = 0;
    while (start < tokens.length - 1 && (NOT_TOKENS.has(tokens[start]) || LEADING_WORDS.has(tokens[start]))) start += 1;
    const keptWords = words.slice(start);
    const keptTokens = tokens.slice(start);
    if (keptTokens.length < 2) continue;
    if (keptTokens.some((part) => NOT_TOKENS.has(part))) continue;
    const name = keptWords.join(" ");
    const key = name.toLowerCase();
    if (NOT_PEOPLE.has(key)) continue;
    if (/^(?:thank(?:\s+you)?|birthday(?:\s+wishes)?|holiday(?:\s+greetings?)?|welcome|anniversary|season(?:'s)?(?:\s+greetings)?)$/i.test(name)) continue;
    if (names.some((item) => item.toLowerCase() === key)) continue;
    names.push(name);
  }
  return names;
}

function groupDenied(text: string, kind: "life" | "tfsa") {
  const tidy = String(text || "");
  const noun = kind === "life" ? "life[\\s-]*insurance" : "tfsa";
  const mentioned = new RegExp(`\\b${noun}\\b`, "i").test(tidy);
  if (!mentioned) return false;
  return new RegExp(`\\b(?:not|no|without|except|don'?t|do not|never|isn'?t|is not)\\b[^.]{0,60}\\b(?:the\\s+|my\\s+)?(?:${noun}|group|tag|audience|broader|whole)\\b`, "i").test(tidy);
}

export function requestedTag(text: string) {
  const tidy = String(text || "");
  if (/\blife[\s-]*insurance\b/i.test(tidy) && /\b(?:clients?|group|audience|list|people|contacts?)\b/i.test(tidy) && !groupDenied(tidy, "life")) return "Life Insurance Client";
  if (/\btfsa\b/i.test(tidy) && /\b(?:clients?|group|audience|list|people|contacts?)\b/i.test(tidy) && !groupDenied(tidy, "tfsa")) return "TFSA Client";
  return "";
}

/** The user asked who would receive something, or who would be left out. */
export function asksAudienceOutcome(text: string) {
  return /\b(?:left out|left off|leave out|excluded|exclusions?|included|ineligible|eligible names|who can(?:not|'t)? receive|who would|who is in|who isn't|cannot receive|can't receive)\b/i.test(String(text || ""));
}

export function audienceRequest(text: string): "group" | "people" | "ask" | "" {
  const tidy = String(text || "");
  if (asksIssueDates(tidy) || asksContactRecord(tidy) || asksArchiveSearch(tidy) || asksEmailThreadStatus(tidy) || asksStatedMeeting(tidy)) return "";
  const tag = requestedTag(tidy);
  const people = namedPeople(tidy).filter((name) => !/^(?:practice room|board room|north desk|test office)$/i.test(name));
  const wants = asksAudienceOutcome(tidy) || Boolean(tag);
  if (asksAudienceOutcome(tidy) && !tag && !people.length) return "ask";
  if (tag && (wants || asksDeliveryAudience(tidy))) return "group";
  if (people.length && (asksAudienceOutcome(tidy) || asksDeliveryAudience(tidy))) return "people";
  return "";
}

export function audienceClarification() {
  return "Which group should I use for who is included and who is left out? Name life insurance clients, TFSA clients, or the people. I did not guess an audience. Nothing was sent.";
}

export function asksDeliveryAudience(text: string) {
  const tidy = String(text || "");
  if (asksIssueDates(tidy) || asksContactRecord(tidy) || asksArchiveSearch(tidy) || asksEmailThreadStatus(tidy)) return false;
  return Boolean(requestedTag(tidy) || namedPeople(tidy).length)
    && /\b(?:recipients?|included|excluded|eligible|clients?|for|only|left out|leave out)\b/i.test(tidy);
}

export function asksIssueDates(text: string) {
  const tidy = String(text || "");
  const aboutDates = /\b(?:issue dates?|date of issue|policy was issued|policies were issued|issued more than|issued over|issued at least|years ago|older than\s+\d+\s+years)\b/i.test(tidy);
  const aboutPolicies = /\b(?:polic(?:y|ies)|clients?|life[\s-]*insurance)\b/i.test(tidy);
  return aboutDates && aboutPolicies;
}

export function asksExplicitWebFormSearch(text: string) {
  const tidy = String(text || "");
  if (/\b(?:do not|don't|never|without)\s+(?:search|look|check)\b[^.]{0,40}\b(?:web|online|internet)\b/i.test(tidy)) return false;
  const web = /\b(?:search|look|check)\s+(?:the\s+)?(?:web|online|internet)\b/i.test(tidy)
    || /\b(?:web search|search online|search the internet)\b/i.test(tidy)
    || /\b(?:on|from)\s+the\s+(?:web|internet)\b/i.test(tidy);
  const form = /\b(?:forms?|applications?|beneficiary[-\s]?change|change of beneficiary)\b/i.test(tidy);
  return web && form;
}

export function asksContactRecord(text: string) {
  const tidy = String(text || "");
  if (asksExplicitWebFormSearch(tidy)) return false;
  if (/\b(?:forms?|applications?|beneficiary[-\s]?change)\b/i.test(tidy) && /\b(?:search|find|look|get|official|useful links?)\b/i.test(tidy)) return false;
  const people = namedPeople(tidy);
  if (people.length < 1 || people.length > 3) return false;
  if (/\b(?:newsletters?|e-?letters?|e-?cards?|drips?|campaigns?)\b/i.test(tidy) && !/\bcontacts?\b/i.test(tidy)) return false;
  const details = /\b(?:contact details|saved details|saved contact|contact record|contact table|saved record|details came from|where those details|where that record|what(?:'s| is) saved|on file)\b/i.test(tidy);
  const fromContacts = /\b(?:from|in)\b[^.]{0,50}\b(?:unique advisor\s+)?contacts?\b/i.test(tidy)
    || (/\bcontacts?\b/i.test(tidy) && /\b(?:show|read|open|find|display)\b/i.test(tidy) && /\b(?:email|tags?|phone|alone|only)\b/i.test(tidy));
  const source = /\b(?:came from|its source|the source|source|database only|unique advisor database|unique advisor)\b/i.test(tidy);
  const fieldList = /\b(?:including|include|with)\b[^.]{0,40}\b(?:e-?mail|tags?|phone)\b/i.test(tidy) && /\bcontacts?\b/i.test(tidy);
  return details || fromContacts || fieldList || (source && /\b(?:contacts?|records?|details|saved|file)\b/i.test(tidy));
}

export function asksArchiveSearch(text: string) {
  const tidy = String(text || "");
  if (/\b(?:move|shorten|reorder|rearrange|add an article|open the saved)\b/i.test(tidy)) return false;
  if (/\b(?:newsletter|issue|copy)\s+(?:number|no\.?|#)\s*\d+\b/i.test(tidy) && /\b(?:preview|rehearse|look like|show)\b/i.test(tidy)) return false;
  const archive = /\b(?:archives?|archived|saved[-\s]?cop(?:y|ies)|newsletter copies|newsletter archive)\b/i.test(tidy);
  const whichSaved = /\b(?:which|what)\b[^.]{0,60}\b(?:saved|archived)\b[^.]{0,40}\b(?:issues?|newsletters?|copies|articles?|pieces?)\b/i.test(tidy);
  const piece = /\b(?:piece|articles?|heading|text)\b/i.test(tidy) && /\b(?:include|contain|mention(?:s|ing)?|about|on)\b/i.test(tidy) && /\b(?:saved|issues?|newsletter|archive|copies)\b/i.test(tidy);
  if (!archive && !whichSaved && !piece) return false;
  const searching = /\b(?:search|find|look through|look for|look up|list matching|matching saved|containing|mention|report|which|what|include)\b/i.test(tidy);
  return searching;
}

/** The user asked to read the saved drip text, timing, or who would receive it. */
export function asksSavedCampaignContent(text: string) {
  const tidy = String(text || "");
  if (!/\b(?:drips?|campaigns?)\b/i.test(tidy)) return false;
  const reads = /\b(?:inspect|review|read|show|display|list|walk|explain|identify|preview|look at|go through|let me see|stored|saved messages)\b/i.test(tidy);
  const content = /\b(?:messages?|steps?|articles?|delays?|waits?|timing|exclusions?|excluded|eligible|ineligible|cannot receive|can't receive|who (?:would|can|cannot|can't))\b/i.test(tidy);
  return reads && content;
}

/** Pause, cancel, resume, or a status question. "Leave it inactive" by itself is not one of these. */
export function explicitCampaignLifecycle(text: string) {
  const tidy = String(text || "")
    .replace(/\b(?:leave|keep|remain|stays?|left|stay)\b[^.]{0,50}\b(?:inactive|paused|off|unchanged|as is|switched off)\b/gi, " ")
    .replace(/\b(?:make|do)\s+no\s+changes?\b/gi, " ")
    .replace(/\bchange nothing\b/gi, " ")
    .replace(/\b(?:do not|don't|never|without)\s+(?:change|start|enroll|enrol|send|launch|activate|edit)\b[^.]*/gi, " ");
  return /\b(?:\bpause\b|paused|on hold|resume|cancel|unsubscribe|opt[\s-]?out)\b/i.test(tidy)
    || /\b(?:whether it is|if it is active|saved status|its status|is it active|is the .+ (?:active|inactive))\b/i.test(tidy)
    || /\b(?:put|place|set)\b[^.]{0,30}\b(?:on hold|paused)\b/i.test(tidy);
}

/** A read of a saved drip. It is not permission to enroll or start it. */
export function asksSavedCampaignReview(text: string) {
  const tidy = String(text || "");
  if (!/\b(?:drips?|campaigns?)\b/i.test(tidy)) return false;
  if (explicitCampaignLifecycle(tidy) && !asksSavedCampaignContent(tidy)) return false;
  if (asksSavedCampaignContent(tidy)) return true;
  if (/\b(?:change|set|make|update)\b[^.]{0,40}\b(?:timing|wait|interval|step)\b/i.test(tidy) && !/\b(?:review only|read only|walk me through|who would)\b/i.test(tidy)) return false;
  return /\b(?:walk me through|walk through|step by step|every message|the waits|who would be excluded|review only|read only|not permission|preview|show who)\b/i.test(tidy);
}

export function asksCampaignControl(text: string) {
  const tidy = String(text || "");
  if (!/\b(?:campaigns?|drips?)\b/i.test(tidy)) return false;
  if (asksSavedCampaignContent(tidy) && !explicitCampaignLifecycle(tidy)) return false;
  if (/\b(?:change|wait|timing|interval|step|article)\b/i.test(tidy) && !/\b(?:pause|paused|on hold|resume|status|active|inactive)\b/i.test(tidy)) return false;
  return /\b(?:pause|paused|on hold|resume|cancel|stop|status|inactive|unsubscribe|opt[\s-]?out|whether it is|if it is active)\b/i.test(tidy);
}

export function campaignControlVerb(text: string): "pause" | "resume" | "cancel" | "unsubscribe" | "status" {
  const tidy = String(text || "");
  const blockedStart = /\b(?:do not|don't|never)\s+(?:start|resume|run|launch)\b/i.test(tidy);
  if (/\b(?:unsubscribe|opt[\s-]?out)\b/i.test(tidy)) return "unsubscribe";
  if (/\bcancel\b/i.test(tidy)) return "cancel";
  if (/\b(?:pause|paused|stop|on hold)\b/i.test(tidy)) return "pause";
  if (/\bresume\b/i.test(tidy) && !blockedStart) return "resume";
  return "status";
}

export function campaignStatusReply(name: string, active: boolean, verb: "pause" | "resume" | "status") {
  if (verb === "pause") {
    return active
      ? `“${name}” was active. It is now paused and not active. Nothing was sent.`
      : `“${name}” is saved and not active. I did not start it, and nothing was sent.`;
  }
  if (verb === "resume") {
    return active
      ? `“${name}” is already active. Nothing was sent.`
      : `“${name}” is saved and not active. I did not start it. Nothing was sent.`;
  }
  return `“${name}” is saved and ${active ? "active" : "not active"}. Nothing was started or sent.`;
}

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function stillWantsDelivery(text: string) {
  const allowed = String(text || "").replace(/\b(?:do not|don't|never|without)\b[^.]*/gi, " ");
  if (/\b(?:send|deliver|start|run|launch|book)\b/i.test(allowed)) return true;
  return /\b(?:e-?mail|mail)\s+(?:it|this|that|them|him|her|out|to)\b/i.test(allowed);
}

function calendarHandsOff(text: string) {
  const tidy = String(text || "");
  if (/\b(?:do not|don't|never|without)\b/i.test(tidy)) return true;
  if (/\bno\b[^.]{0,90}\b(?:book|booking|calendar|schedule|invitation|invite|outlook|access)\b/i.test(tidy)) return true;
  if (/\b(?:just show|only show|display only|proposed details|rehearsal only|not a booking)\b/i.test(tidy)) return true;
  if (/\b(?:leave|ignore|skip)\b[^.]{0,50}\b(?:calendar|calendars|outlook|email|mailbox|invitation|invite)\b/i.test(tidy)) return true;
  if (/\buntouched\b/i.test(tidy) && /\b(?:calendar|email|outlook|booking)\b/i.test(tidy)) return true;
  return false;
}

/** A meeting whose details are already in the request, and which must not be booked or looked up. */
export function asksStatedMeeting(text: string) {
  const tidy = String(text || "");
  if (stillWantsDelivery(tidy)) return false;
  if (/\b(?:my appointments|my calendar|what(?:'s| is) on my)\b/i.test(tidy)) return false;
  const meeting = /\b(?:meetings?|appointments?|face[- ]to[- ]face|in[- ]person)\b/i.test(tidy);
  if (!meeting) return false;
  const sketch = /\b(?:sketch|outline|proposed details|rehearsal|review a proposed|proposed (?:in[- ]person|visit|meeting|appointment)|display only)\b/i.test(tidy);
  if (!calendarHandsOff(tidy) && !sketch) return false;
  const when = new RegExp(`\\b(?:${MONTH}\\.?\\s+\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH})\\b`, "i").test(tidy);
  const time = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(tidy);
  return when || time || namedPeople(tidy).length > 0;
}

export function asksMeetingPreview(text: string) {
  const tidy = String(text || "");
  if (asksStatedMeeting(tidy)) return true;
  return /\b(?:meetings?|in[- ]person|appointments?)\b/i.test(tidy)
    && /\b(?:preview|availability|details|sketch|outline)\b/i.test(tidy)
    && calendarHandsOff(tidy);
}

export function asksEmailThreadStatus(text: string) {
  const tidy = String(text || "");
  if (/\bpreview the signature request\b/i.test(tidy)) return false;
  if (/\b(?:prepare|for signature)\b/i.test(tidy) && !/\b(?:repl(?:y|ies)|conversation|thread|monitor)\b/i.test(tidy)) return false;
  const aboutMail = /\b(?:e-?mail|mail)\b/i.test(tidy) || /\bsignature workflow test\b/i.test(tidy);
  const aboutThread = /\b(?:threads?|conversations?|locally stored|stored locally|titled|named)\b/i.test(tidy);
  const aboutReplies = /\b(?:repl(?:y|ies)|monitor|status|whether)\b/i.test(tidy);
  return aboutMail && aboutThread && aboutReplies;
}

export function meetingPreviewFacts(text: string) {
  const tidy = String(text || "");
  const when = tidy.match(new RegExp(`\\b(${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?\\s+\\d{4})\\b`, "i"))?.[1] || "";
  const time = tidy.match(/\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i)?.[1] || "";
  const numbered = tidy.match(/\b(\d+)\s*-?\s*(?:minutes?|mins?)\b/i)?.[1] || "";
  const spoken = tidy.match(/\b(forty[-\s]?five|fifteen|twenty|thirty|forty|sixty|ninety)\b(?:\s+|-)?minutes?\b/i)?.[1]?.toLowerCase().replace(/\s+/g, "") || "";
  const spokenMinutes: Record<string, string> = { fifteen: "15", twenty: "20", thirty: "30", forty: "40", fortyfive: "45", "forty-five": "45", sixty: "60", ninety: "90" };
  const minutes = numbered
    || (spoken ? spokenMinutes[spoken] || "" : "")
    || (/\bhalf[-\s]?(?:an[-\s])?hour\b/i.test(tidy) ? "30" : "")
    || (/\bquarter[-\s]?(?:of[-\s])?(?:an[-\s])?hour\b/i.test(tidy) ? "15" : "")
    || (/\ban hour\b/i.test(tidy) ? "60" : "");
  const namedOffice = /\btest office\b/i.test(tidy) ? "Test Office" : "";
  const room = tidy.match(/\b([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})\s+(Room|Office|Desk|Hall)\b/u);
  const roomName = room ? `${room[1]} ${room[2]}`.replace(/\s+/g, " ").trim() : "";
  const atPlace = tidy.match(/\b(?:at|in)\s+(?:the\s+)?([A-Z][\p{L}0-9'’-]+(?:\s+[A-Z][\p{L}0-9'’-]+){0,3})/u)?.[1] || "";
  const cleaned = atPlace.replace(/\s+(?:Do|Not|Please|And|Without|Never|On|At|In)$/u, "").replace(/[.,;:]+$/g, "").trim();
  const place = namedOffice || roomName || (/^(?:january|february|march|april|may|june|july|august|september|october|november|december|toronto|america)$/i.test(cleaned) ? "" : cleaned);
  const withPerson = tidy.match(/\bwith\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,2})/u)?.[1] || "";
  const person = withPerson || namedPeople(tidy).find((name) => name.toLowerCase() !== place.toLowerCase() && !/\b(?:room|office|desk|hall)$/i.test(name)) || "";
  const kind = /\bface[- ]to[- ]face\b/i.test(tidy) || /\bin[- ]person\b/i.test(tidy)
    ? "face-to-face"
    : /\bzoom\b/i.test(tidy) ? "Zoom" : "";
  return {
    person,
    when,
    time,
    minutes,
    place,
    kind,
    zone: /toronto/i.test(tidy) ? "America/Toronto" : "",
    askedPerson: /\bwith\b/i.test(tidy),
  };
}

export function meetingDetailReply(facts: { when?: string; time?: string; minutes?: string; place?: string; zone?: string; person?: string; kind?: string; askedPerson?: boolean }, isolated: boolean) {
  const missing = [
    facts.when ? "" : "the date",
    facts.time ? "" : "the start time",
    facts.minutes ? "" : "the length",
    facts.place ? "" : "the place",
    facts.askedPerson && !facts.person ? "who it is with" : "",
  ].filter(Boolean);
  return [
    "Meeting details stated in this request. Nothing was booked.",
    facts.kind ? `Kind: ${facts.kind}` : "",
    `Date: ${facts.when || "not stated"}`,
    `Time: ${facts.time || "not stated"}`,
    `Length: ${facts.minutes ? `${facts.minutes} minutes` : "not stated"}`,
    `Place: ${facts.place || "not stated"}`,
    facts.person ? `With: ${facts.person}` : "",
    facts.zone ? `Time zone named in the request: ${facts.zone}` : "No time zone was named in the request.",
    missing.length ? `Still needed before this could be booked: ${missing.join(", ")}. I did not guess them.` : "",
    isolated
      ? "Outlook was not contacted. This isolated copy does not check sign-in, so this is not a report that Outlook is signed out."
      : "No calendar provider was contacted for this preview.",
    "Nothing was sent.",
  ].filter(Boolean).join("\n");
}

/** A read-only lookup should drop an earlier preview instead of leaving it on screen. */
export function clearsStalePreview(text: string) {
  const tidy = String(text || "");
  return asksArchiveSearch(tidy) || asksContactRecord(tidy) || asksIssueDates(tidy) || asksEmailThreadStatus(tidy) || asksCampaignControl(tidy) || asksSavedCampaignReview(tidy) || asksStatedMeeting(tidy);
}

/** The open newsletter, letter, or card is what this turn is still editing. */
export function keepsOpenPreview(text: string) {
  const tidy = String(text || "");
  if (asksSavedCampaignReview(tidy) || asksArchiveSearch(tidy) || asksContactRecord(tidy) || asksEmailThreadStatus(tidy)) return false;
  if (/\b(?:move|shorten|reorder|rearrange|add an article|this article|that article|the open|currently open)\b/i.test(tidy)) return true;
  if (/\b(?:newsletter|e-?letter|e-?card)\b/i.test(tidy) && /\b(?:preview|show|open|edit|change|update|for|rehearse|look like)\b/i.test(tidy) && !/\b(?:drips?|campaigns?)\b/i.test(tidy)) return true;
  if (/^(?:please\s+)?(?:up|down|move it|shorten it|keep it)\b/i.test(tidy)) return true;
  return false;
}

/**
 * A new subject, including a fallback the classifiers did not name,
 * replaces the preview on screen. Continuing the open draft does not.
 */
export function shouldReplacePreview(text: string) {
  const tidy = String(text || "");
  if (!tidy.trim() || keepsOpenPreview(tidy)) return false;
  if (clearsStalePreview(tidy) || asksMeetingPreview(tidy) || asksSavedCampaignReview(tidy)) return true;
  if (/\b(?:display only|leave\b[^.]{0,40}\buntouched|do not touch|don't touch)\b/i.test(tidy)) return true;
  return !/\b(?:newsletter|article|e-?letter|e-?card|paragraph|greeting)\b/i.test(tidy);
}

export type ClassifiedAudience = {
  included: Array<{ name: string; email: string }>;
  excluded: Array<{ name: string; email: string; reason: string }>;
  outside: Array<{ name: string; reason: string }>;
  missing: string[];
};

export function classifyAudience(rows: AudienceRow[], request: string): ClassifiedAudience {
  const names = namedPeople(request);
  const tag = requestedTag(request);
  const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
  const missing = names.filter((name) => !byName.has(name.toLowerCase()));
  const scope = names.length
    ? names.flatMap((name) => {
      const row = byName.get(name.toLowerCase());
      return row ? [row] : [];
    })
    : tag
      ? rows.filter((row) => row.tags.split(",").some((item) => item.trim().toLowerCase() === tag.toLowerCase()))
      : [];
  const included: ClassifiedAudience["included"] = [];
  const excluded: ClassifiedAudience["excluded"] = [];
  for (const row of scope) {
    const reason = contactDeliveryBlock(row.tags, row.email);
    if (reason) excluded.push({ name: row.name, email: row.email, reason });
    else included.push({ name: row.name, email: row.email });
  }
  const wantsOutside = /\b(?:not in the (?:requested )?group|not tagged|who is not|everyone else)\b/i.test(request);
  const outside = wantsOutside && tag && !names.length
    ? rows
      .filter((row) => !scope.includes(row))
      .map((row) => ({ name: row.name, reason: `not tagged ${tag}` }))
    : [];
  return { included, excluded, outside, missing };
}

export function formatAudience(result: ClassifiedAudience, label: string) {
  const lines = [
    `${label}: ${result.included.length} can receive, ${result.excluded.length} excluded${result.outside.length ? `, ${result.outside.length} not in the group` : ""}.`,
    "Included:",
    ...result.included.map((person) => `- ${person.name} <${person.email}>`),
    result.included.length ? "" : "- none",
    "Excluded:",
    ...result.excluded.map((person) => `- ${person.name}${person.email ? ` <${person.email}>` : ""}: ${person.reason}.`),
    result.excluded.length ? "" : "- none",
  ];
  if (result.outside.length) {
    lines.push("Not in the requested group:", ...result.outside.map((person) => `- ${person.name}: ${person.reason}.`));
  }
  if (result.missing.length) lines.push(...result.missing.map((name) => `${name} is not saved on this desk.`));
  lines.push("Nothing was sent.");
  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
}

export function deliveryReason(tags: string | string[], email: string) {
  const tagText = Array.isArray(tags) ? tags.join(", ") : String(tags || "");
  return contactDeliveryBlock(tagText, email);
}

export function partitionAudience<T extends { email?: string; tags?: string | string[] }>(rows: T[]) {
  const eligible: T[] = [];
  const excluded: Array<T & { reason: string }> = [];
  for (const row of rows) {
    const reason = deliveryReason(row.tags || "", row.email || "");
    if (reason) excluded.push({ ...row, reason });
    else eligible.push(row);
  }
  return { eligible, excluded };
}

export type IssuedRecord = { name: string; source: string; issued: string };

export function parseIssuedDate(text: string) {
  const found = String(text || "").match(/\bpolicy issued:\s*(\d{4}-\d{2}-\d{2})\b/i);
  return found?.[1] || "";
}

export const ISSUE_DATE_ZONE = "America/Toronto";
export const LOCAL_FIXTURE_SOURCE = "Local fictional Assistant Test fixture in this isolated copy. Not a live Dropbox read. This date was not independently verified.";

export function civilDate(now: Date, timeZone = ISSUE_DATE_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

export function dateYearsBefore(day: string, years: number) {
  const [year, month, date] = day.split("-").map(Number);
  return `${year - years}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

/** Calendar date `years` earlier in the advisor time zone, as YYYY-MM-DD. */
export function yearsBack(now: Date, years: number) {
  return dateYearsBefore(civilDate(now), years);
}

export function splitByIssueAge(records: IssuedRecord[], years: number, now: Date) {
  const asOf = civilDate(now);
  const cutoff = dateYearsBefore(asOf, years);
  const older: IssuedRecord[] = [];
  const newer: IssuedRecord[] = [];
  const missing: IssuedRecord[] = [];
  for (const row of records) {
    if (!row.issued) {
      missing.push(row);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.issued)) {
      missing.push({ ...row, issued: "" });
      continue;
    }
    if (row.issued < cutoff) older.push(row);
    else newer.push(row);
  }
  return { older, newer, missing, cutoff, asOf };
}

export function issueDateReply(records: IssuedRecord[], years: number, now: Date) {
  const split = splitByIssueAge(records, years, now);
  const lines = [
    `Life insurance policies issued more than ${years} years before ${split.asOf} (${ISSUE_DATE_ZONE}). Cutoff: ${split.cutoff}. Saved issue dates only.`,
    "These dates come from the local fictional Assistant Test fixture in this copy. They were not read from Dropbox and were not independently verified.",
    `Issued before ${split.cutoff}:`,
    ...(split.older.length
      ? split.older.map((row) => `- ${row.name}: issued ${row.issued}. Source: ${row.source.replace(/\.+$/, "")}.`)
      : ["- none"]),
    "Saved, but not that old:",
    ...(split.newer.length
      ? split.newer.map((row) => `- ${row.name}: issued ${row.issued}. Source: ${row.source.replace(/\.+$/, "")}.`)
      : ["- none"]),
    "Missing a saved issue date (not treated as old or new):",
    ...(split.missing.length
      ? split.missing.map((row) => `- ${row.name}: no issue date is saved. Source: ${row.source.replace(/\.+$/, "")}.`)
      : ["- none"]),
    "This is not a mail-eligibility list. Nothing was sent.",
  ];
  return lines.join("\n");
}

export function requestedIssueYears(text: string) {
  const numbered = String(text || "").match(/\b(?:more than|over|older than|at least)\s+(\d+)\s+years?\b/i);
  return numbered ? Math.max(1, Number(numbered[1])) : 5;
}

export function foldTitle(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function archiveSearchTerm(text: string) {
  const raw = String(text || "");
  const quoted = raw.match(/[“"']([^"”']{2,80})[”"']/);
  if (quoted && !/^(?:do not|don't|read only)$/i.test(quoted[1].trim())) return quoted[1].replace(/^the article\s+/i, "").replace(/[?.!,;:]+$/g, "").trim();
  const onPiece = raw.match(/\b(?:piece|article|heading|story)\s+on\s+(?:the\s+)?(.+?)(?:[?]|$)/i);
  if (onPiece) {
    return onPiece[1].replace(/\b(?:give|list)\b[\s\S]*$/i, "").replace(/[?.!,;:]+$/g, "").trim();
  }
  const mentioned = raw.match(/\bmention(?:s|ing)?\s+(?:the\s+)?(.+?)(?:[?]|\band\b|$)/i);
  if (mentioned && !/^(?:saved|their|the copy)/i.test(mentioned[1].trim())) {
    return mentioned[1].replace(/[?.!,;:]+$/g, "").trim();
  }
  const phrase = raw.match(/\b(?:for|about|containing|mention(?:ing)?|titled|called|named)\s+(.+?)(?:[.?]|$)/i);
  return String(phrase?.[1] || "")
    .replace(/^the article\s+/i, "")
    .split(/\b(?:in the|and report|and their|list matching|do not|don't)\b/i)[0]
    .replace(/\b(?:list|matching|saved|copies|copy|ids?|numbers|and their|do not|don't|create|edit|send|anything|read only)\b[\s\S]*$/i, "")
    .replace(/[?.!,;:]+$/g, "")
    .trim();
}

export function matchingNewsletterCopies(
  copies: Array<{ id: number; title: string; articles: Array<{ title: string; body?: string }> }>,
  term: string,
) {
  const needle = foldTitle(term);
  if (needle.length < 3) return [];
  return copies.flatMap((copy) => {
    const hit = copy.articles.find((article) => {
      const title = foldTitle(article.title);
      const body = foldTitle(article.body || "");
      const hay = `${title} ${body}`.trim();
      return title === needle || (needle.length > 3 && (hay.includes(needle) || (title.length > 8 && needle.includes(title))));
    });
    return hit ? [{ id: copy.id, title: copy.title, article: hit.title }] : [];
  });
}

export function archiveSearchReply(term: string, hits: Array<{ id: number; title: string; article: string }>) {
  if (term.trim().length < 3) return "Say which words to search for in the saved newsletter archive. Nothing was created, edited, or sent.";
  if (!hits.length) return `No saved newsletter copy contains “${term}”. Nothing was created, edited, or sent.`;
  return [
    `Saved newsletter copies containing “${term}”:`,
    ...hits.map((hit) => `- #${hit.id} “${hit.title}” — article “${hit.article}”`),
    "Nothing was created, edited, or sent.",
  ].join("\n");
}

export function emailThreadStatusReply(input: {
  subject: string;
  recipient: string;
  isolated: boolean;
  stored: boolean;
  conversationKnown: boolean;
}) {
  return [
    `Email thread: ${input.subject || "Signature Workflow Test"}.`,
    `Saved test recipient: ${input.recipient || "not recorded"}.`,
    input.stored
      ? "A local thread record is saved on this desk. I read that record only."
      : "No local thread record is saved on this desk. I did not invent a send.",
    input.conversationKnown
      ? "The saved record has a conversation id."
      : "No conversation id is saved, so a reply check has nothing local to compare.",
    input.isolated
      ? "This isolated test copy cannot check replies. Microsoft is not contacted from this copy."
      : "This request did not contact Microsoft, so live replies were not checked.",
    "This is not a signature preview, and no other document was substituted. Nothing was sent.",
  ].join("\n");
}

export function missingEmailNote(name: string) {
  return `${name} has no email saved on this desk. The preview can be shown, but it cannot be sent until an email is recorded.`;
}
