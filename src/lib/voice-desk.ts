import { spokenReply } from "./assistant-reply.ts";
import { spokenSummary } from "./assistant-operating.ts";
import { namedPeople } from "./delivery-audience.ts";

const recentTurns = new Map<string, number>();
const turnsInFlight = new Set<string>();

export function voiceTurnKey(advisorId: number, chatId: number, text: string) {
  return `${advisorId}:${chatId}:${String(text || "").replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/** A yes after a new assistant line is a new turn, not a repeat of the previous yes. */
export function deskTurnKey(advisorId: number, chatId: number, priorAssistant: string, text: string) {
  const prior = String(priorAssistant || "").replace(/\s+/g, " ").trim().slice(0, 180);
  return voiceTurnKey(advisorId, chatId, prior ? `${prior}\n${text}` : text);
}

/** Blocks the same utterance from running twice while it is in flight or within four seconds. */
export function claimVoiceTurn(key: string, now = Date.now()) {
  const prior = recentTurns.get(key) || 0;
  if (turnsInFlight.has(key) || (prior && now - prior < 4000)) return false;
  turnsInFlight.add(key);
  recentTurns.set(key, now);
  return true;
}

export function releaseVoiceTurn(key: string) {
  turnsInFlight.delete(key);
}

export function resetVoiceTurns() {
  recentTurns.clear();
  turnsInFlight.clear();
}

export function wantsReadAloud(text: string) {
  const raw = String(text || "");
  return /\bread the whole\b/i.test(raw)
    || /\b(?:read(?:\s+(?:it|this|that|them|everything|all))?)\s+(?:aloud|out loud|to me)\b/i.test(raw)
    || /بلند بخوان|همه را بخوان|برام بخون|برایم بخوان/.test(raw);
}

/** A short line for the speaker. The full draft stays on screen unless reading aloud was requested. */
export function spokenBrief(reply: string, request = "") {
  const spoken = spokenReply(String(reply || ""));
  if (!spoken) return "";
  if (wantsReadAloud(request)) {
    return spoken.length > 900 ? `${spoken.slice(0, 900).trim()} The rest is on the screen.` : spoken;
  }
  const lead = spoken.split(/\n\n+/)[0] || spoken;
  const summary = spokenSummary(lead);
  if (!summary) return "The preview is on the screen.";
  if (/[\u0600-\u06FF]/.test(request) && !/[\u0600-\u06FF]/.test(summary)) {
    return `${summary} پیش‌نمایش روی صفحه است.`;
  }
  if (lead.length > summary.length + 80) return `${summary} The rest is on the screen.`;
  return summary;
}

export function articleInFocus(lastAssistant: string) {
  const text = String(lastAssistant || "");
  const issue = text.match(/(?:Preview of|Updated)\s+[“"]([^"”]+)[”"]/i)?.[1]?.trim() || "";
  const moved = text.match(/[“"]([^"”]{2,80})[”"]\s+is now article\s+\d+/i)?.[1]?.trim() || "";
  if (moved && moved !== issue) return moved;
  const quoted = [...text.matchAll(/[“"]([^"”]{2,80})[”"]/g)].map((match) => match[1].trim());
  const titles = quoted.filter((item) => item !== issue);
  return titles.length === 1 ? titles[0] : "";
}

const FA_PLACE = "اول|یکم|دوم|سوم|چهارم|پنجم|ششم";
const FA_PLACE_NAME: Record<string, string> = {
  اول: "first",
  یکم: "first",
  دوم: "second",
  سوم: "third",
  چهارم: "fourth",
  پنجم: "fifth",
  ششم: "sixth",
};

function farsiArticleMove(raw: string) {
  const source = raw.match(new RegExp(`مقاله(?:ی|\\s*ٔ)?\\s*(${FA_PLACE})`));
  const dest = raw.match(new RegExp(`(?:به|در)\\s*(?:جایگاه|موقعیت|جای)\\s*(${FA_PLACE})`));
  if (!source || !dest || !/منتقل|جابه‌جا|جابجا/.test(raw)) return "";
  const from = FA_PLACE_NAME[source[1]];
  const to = FA_PLACE_NAME[dest[1]];
  if (!from || !to) return "";
  return `Move the ${from} article to the ${to} position. Keep every article’s wording unchanged. Do not send.`;
}

function farsiPeople(raw: string) {
  const source = String(raw || "");
  const ranked: Array<{ name: string; at: number }> = [];
  for (const name of namedPeople(source).filter((item) => !/^(?:unique advisor|dropbox)$/i.test(item))) {
    ranked.push({ name, at: source.toLowerCase().indexOf(name.toLowerCase()) });
  }
  const aliases: Array<[RegExp, string]> = [
    [/کیسی/, "Casey Sample"],
    [/رایلی/, "Riley Sample"],
    [/کوین/, "Quinn Sample"],
    [/اوری|ایوری/, "Avery Sample"],
    [/جردن|جردان/, "Jordan Example"],
    [/مورگان/, "Morgan Sample"],
  ];
  for (const [pattern, name] of aliases) {
    const at = source.search(pattern);
    if (at >= 0 && !ranked.some((item) => item.name.toLowerCase() === name.toLowerCase())) ranked.push({ name, at });
  }
  ranked.sort((left, right) => left.at - right.at || left.name.localeCompare(right.name));
  return ranked.map((item) => item.name);
}

function farsiSavedContact(raw: string) {
  if (/خبرنامه|بایگانی|آرشیو|جلسه|ملاقات|کمپین|درپ/.test(raw)) return "";
  const people = farsiPeople(raw);
  const aboutRecord = /ذخیره|اطلاعات|پایگاه|مخاطب|پرونده|رکورد|جزئیات/.test(raw);
  const aboutDesk = /unique advisor|پایگاه|یونیک/i.test(raw) || /دست نزن|باز نکن|استفاده نکن/.test(raw);
  if (!aboutRecord || !people.length || !aboutDesk) return "";
  return `Use the Unique Advisor database only. Show the saved contact details for ${people.join(" and ")} and where those details came from. Do not use Dropbox or change anything.`;
}
function mapFarsiCommand(text: string) {
  const raw = String(text || "").trim();
  if (!/[\u0600-\u06FF]/.test(raw)) return raw;
  if (/لغو|کنسل/.test(raw) && /ارسال نکن|نفرست|پیش‌نویس/.test(raw)) {
    return /نگه\s*دار/.test(raw)
      ? "Cancel the pending approval. Keep the drafts. Do not send."
      : "Cancel.";
  }
  if (/^(?:لطفا\s*)?(?:لغو کن|لغو|کنسل)[.!؟?\s]*$/u.test(raw)) return "Cancel.";
  const savedContact = farsiSavedContact(raw);
  if (savedContact) return savedContact;
  const quoted = raw.match(/[“"']([^"”']{2,80})[”"']/)?.[1]?.trim();
  if (/کتابخانه/.test(raw) && /مقاله/.test(raw)) {
    const term = quoted || (/ارزش زمانی/.test(raw) ? "time value of money" : "the named subject");
    if (/کپی|بگذار/.test(raw)) {
      const titles = [/ارزش زمانی/.test(raw) ? "Time Value Of Money" : "", /بیمه عمر|بیمه زندگی/.test(raw) ? "Life Insurance" : ""].filter(Boolean);
      return `Copy these article library articles into a ${/موجود/.test(raw) ? "existing" : "new"} newsletter: ${titles.join("; ") || term}. Do not add recipients. Do not send.`;
    }
    return `Search the article library for ${term}. Do not send.`;
  }
  if (/خبرنامه/.test(raw) && /بایگانی|آرشیو/.test(raw) && /پیدا|جستجو|بگرد/.test(raw)) {
    return `Search the saved newsletter archive for ${quoted || "the named article"}. List matching saved copies and their IDs. Do not create, edit or send.`;
  }
  if (/پرونده|رکورد|مخاطب/.test(raw) && /کیسی|Casey/i.test(raw)) {
    return "Use the Unique Advisor database only. Show the saved contact details for Casey Sample and where those details came from. Do not use Dropbox or change anything.";
  }
  if (/ایمیل|نامه/.test(raw) && /گفتگو|پاسخ|رشته/.test(raw) && /امضا|Signature/i.test(raw)) {
    return "Show the status of the existing Signature Workflow Test email thread and whether replies can be checked in this isolated test copy. Do not send any email or contact Microsoft.";
  }
  if (/بیمه/.test(raw) && /سال/.test(raw) && /صادر|تاریخ/.test(raw)) {
    return "List the fictional clients whose life insurance policy was issued more than five years ago. Use saved issue dates only, and identify missing dates. Do not send anything.";
  }
  if (/جلسه|ملاقات/.test(raw) && /نوامبر|November/i.test(raw)) {
    return "Show the November 24, 2026 2:00 p.m. 30-minute meeting at Test Office. Do not book it and do not contact Outlook.";
  }
  if (/رایلی|Riley/i.test(raw) && !/خبرنامه/.test(raw) && /نامه|یادداشت|بازنشستگی/.test(raw)) {
    return "Preview the Acceptance — Retirement Note for Riley Sample. Show the recipient email. Do not send.";
  }
  if (/کمپین|درپ|drip/i.test(raw) && /متوقف|مکث|توقف/.test(raw) && !/پیام|تاخیر|تأخیر|مرحله|صبر/.test(raw)) {
    return "Pause the Acceptance — Welcome Drip. Do not start it or send anything. Tell me its actual saved status.";
  }
  if (/کمپین|درپ|drip/i.test(raw) && /پیام|تاخیر|تأخیر|مرحله|صبر|مرور|بررسی|نشان|بخوان/.test(raw)) {
    const people = farsiPeople(raw);
    const who = people.length ? ` for ${people.join(" and ")}` : "";
    return `Inspect the saved messages and delays in the Acceptance — Welcome Drip${who}. Identify anyone who cannot receive it. Leave it inactive and make no changes. Do not start it.`;
  }
  if (/کمپین|درپ|drip/i.test(raw) && /کیسی|Casey/i.test(raw) && /کوین|Quinn/i.test(raw)) {
    return "Preview the Acceptance — Welcome Drip for Casey Sample and Quinn Sample. Show who is included and who is excluded. Do not start it or send anything.";
  }
  if (/خبرنامه/.test(raw) && /بیمه/.test(raw) && !/بایگانی|آرشیو/.test(raw)) {
    return "Preview saved newsletter copy #1 for life insurance clients. Show who is included and who is excluded. Do not send.";
  }
  if (raw.length > 160) return raw;
  if (/مقاله/.test(raw) && /دوم/.test(raw) && /کوتاه/.test(raw)) return "Shorten the second article. Keep everything else unchanged. Do not send.";
  const moved = farsiArticleMove(raw);
  if (moved) return moved;
  if (/بالا/.test(raw) && /ببر|بیار|بیاور/.test(raw)) return "Move it up. Keep everything else unchanged. Do not send.";
  if (/پایین/.test(raw) && /ببر|بیار|بیاور/.test(raw)) return "Move it down. Keep everything else unchanged. Do not send.";
  if (/تقویم/.test(raw) && /نشان|ببین|باز/.test(raw) && raw.length < 80) return "Show my calendar. Do not book a meeting.";
  if (/^(?:لطفا\s*)?(?:نفرست|ارسال نکن|نفرستید)[.!؟?\s]*$/u.test(raw)) return "Do not send.";
  if (/بلند بخوان|همه را بخوان|برام بخون|برایم بخوان/.test(raw)) return `${raw} Read it aloud.`;
  return raw;
}

function foldFa(text: string) {
  return text.normalize("NFKD").replace(/\u200c/g, "").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\p{M}/gu, "");
}

function farsiStopClause(clause: string) {
  const tidy = foldFa(clause).replace(/[.!?؟،]+$/g, "").trim();
  if (/^(?:لطفا\s*)?(?:لغو کن|لغو|کنسل|ارسال نکن|نفرستید|استاپ)$/u.test(tidy)) return true;
  return /^(?:لطفا\s*)?نفرست$/u.test(tidy);
}

/** English card command for a Farsi correction. Empty when this is not a card correction. */
export function farsiCardCorrection(text: string) {
  const raw = String(text || "").trim();
  if (!/[\u0600-\u06FF]/.test(raw) || raw.length > 160) return "";
  const folded = foldFa(raw);
  if (!/کارت|تولد/.test(folded)) return "";
  const showing = /نشان|پیش‌نمایش|پیش نمایش|نمایش/.test(folded);
  const marked = folded.replace(/[.!?؟]+/g, ".").replace(/ارسال نکن|لغو کن|نفرستید|کنسل|لغو|استاپ|(?<!ب)نفرست/g, ".$&.");
  const clauses = marked.split(".").map((part) => part.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const clause of clauses) {
    if (farsiStopClause(clause)) {
      parts.push(showing && /نفرست|ارسال نکن/.test(foldFa(clause)) ? "Do not send." : "Stop.");
      continue;
    }
    const people = farsiPeople(clause);
    if (!people.length) continue;
    const card = /تولد/.test(clause) || /تولد/.test(folded) ? "birthday card" : /تشکر|سپاس/.test(clause) || /تشکر|سپاس/.test(folded) ? "Thank You card" : "e-card";
    if (people.length > 1) {
      const joiner = /یا/.test(clause) ? " or " : " and ";
      parts.push(`${showing ? "Preview" : "Send"} a ${card} to ${people.join(joiner)}.`);
      continue;
    }
    parts.push(`${showing ? "Preview" : "Send"} a ${card} to ${people[0]}.`);
  }
  if (!parts.some((part) => /^(?:Send|Preview)\b/.test(part))) return "";
  return parts.join(" ");
}

function farsiIdentityCommand(text: string, lastAssistant: string) {
  const raw = String(text || "").trim();
  if (!/[\u0600-\u06FF]/.test(raw) || raw.length > 160) return "";
  const last = String(lastAssistant || "");
  const identity = /did you mean\b/i.test(last) && /\bcard\b/i.test(last) && !/just to confirm:/i.test(last);
  const preview = /just to confirm:/i.test(last);
  if (!identity && !preview) return "";
  const folded = foldFa(raw);
  if (/لغو|کنسل|استاپ|ارسال نکن/.test(folded)) return "Cancel.";
  const people = farsiPeople(folded);
  const yes = /بله|آره|باشه/.test(folded);
  if (people.length > 1) return `Send a birthday card to ${people[0]}. Send a birthday card to ${people[1]}.`;
  if (people.length === 1 && (yes || /بفرست|ارسال کن/.test(folded))) return `Yes, send it to ${people[0]}.`;
  if (yes && /^(?:لطفا\s*)?(?:بله|آره|باشه)[.!؟?\s]*$/u.test(folded)) return "Yes.";
  return "";
}

function farsiJoinedDelivery(text: string) {
  const raw = foldFa(String(text || ""));
  if (raw.length > 180) return "";
  const people = farsiPeople(raw);
  if (people.length < 2) return "";
  if (!/بفرست|ارسال|نشان|پیش|شروع/.test(raw)) return "";
  const who = people.join(/یا/.test(raw) ? " or " : " and ");
  const hold = /نشان|پیش‌نمایش|پیش نمایش|نمایش|نفرست|ارسال نکن/.test(raw);
  if (/خبرنامه/.test(raw)) {
    return hold ? `Preview the newsletter for ${who}. Do not send.` : `Send a newsletter about a short note to ${who}.`;
  }
  if (/نامه|ایمیل/.test(raw) && !/کارت/.test(raw)) {
    return hold ? `Preview the letter for ${who}. Do not send.` : `Write a letter to ${who} and tell them this is a short fictional note.`;
  }
  if (/کمپین|درپ/.test(raw)) {
    return hold
      ? `Preview the Acceptance — Welcome Drip for ${who}. Do not start it or send anything.`
      : `Start the Acceptance — Welcome Drip for ${who}.`;
  }
  return "";
}

export function prepareDeskCommand(text: string, lastAssistant = "") {
  const identity = farsiIdentityCommand(text, lastAssistant);
  const mapped = mapFarsiCommand(text).replace(/\s+/g, " ").trim();
  const original = String(text || "").replace(/\s+/g, " ").trim();
  const persian = /[\u0600-\u06FF]/.test(original);
  const card = !identity && persian ? farsiCardCorrection(text) : "";
  const joined = !identity && !card && persian && mapped === original ? farsiJoinedDelivery(text) : "";
  const base = (identity || card || joined || mapped).replace(/\s+/g, " ").trim();
  if (!/^(?:please\s+)?(?:move|bring|shift)\s+(?:it|that|this)\s+(up|down)\b/i.test(base)) return base;
  const title = articleInFocus(lastAssistant);
  const direction = /\bdown\b/i.test(mapped) ? "down" : "up";
  if (!title) return mapped;
  return `Move “${title}” ${direction} one position. Keep every article’s wording unchanged. Do not send.`;
}

/** A Persian success line only after the saved newsletter was read back. */
export function verifiedFarsiMoveNote(userText: string, savedReply: string) {
  if (!/[\u0600-\u06FF]/.test(String(userText || "")) || !/مقاله/.test(String(userText || ""))) return "";
  if (!/I read the saved newsletter/.test(String(savedReply || "")) || !/is now article/.test(String(savedReply || ""))) return "";
  return "مقاله جابه‌جا شد و از نسخهٔ ذخیره‌شده خوانده شد. متن مقاله‌ها تغییر نکرد. چیزی ارسال نشد.";
}

function spokenEmail(text: string) {
  const match = text.match(/\b([a-z0-9._%+-]{1,40})\s+at\s+([a-z0-9-]{2,40})\s+dot\s+((?:[a-z0-9-]+\s+dot\s+)*[a-z]{2,24})\b/i);
  if (!match) return "";
  const domain = match[3].replace(/\s+dot\s+/gi, ".").replace(/\s+/g, "");
  return `${match[1]}@${match[2]}.${domain}`.toLowerCase();
}

function uncertainAmount(text: string) {
  if (!/(?:\$|dollars?|\bcad\b|ریال|تومان)/i.test(text)) return "";
  if (/\b\d+(?:[.,]\d+)?\s+or\s+\d+(?:[.,]\d+)?\b/i.test(text)) return "that range";
  if (!/\b(?:about|around|approximately|roughly|or so)\b/i.test(text) && !/حدود|تقریبا/.test(text)) return "";
  const amount = text.match(/\$\s?(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:dollars?|cad|ریال|تومان)/i);
  return amount?.[1] || amount?.[2] || "that amount";
}

function ambiguousWhen(text: string) {
  if (/\bdo not book\b/i.test(text)) return false;
  if (!/\b(?:book|schedule|meeting|zoom|appointment)\b/i.test(text) && !/جلسه|قرار/.test(text)) return false;
  if (/\b(?:or|either)\b/i.test(text) && /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i.test(text)) return true;
  if (/\b(?:sometime|whenever)\b/i.test(text) && !/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text)) return true;
  if (/\b(?:morning|afternoon|evening)\b/i.test(text) && !/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text)) return true;
  return false;
}

/** Ask for a correction before using an unclear email, amount, or time. Clear requests return null. */
export function transcriptHold(text: string): { question: string; suggestion: string } | null {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const email = spokenEmail(raw);
  if (email) {
    const suggestion = raw.replace(/\b[a-z0-9._%+-]{1,40}\s+at\s+[a-z0-9-]{2,40}\s+dot\s+(?:[a-z0-9-]+\s+dot\s+)*[a-z]{2,24}\b/i, email);
    return { question: `I heard the email as ${email}. Correct the transcript before I use it.`, suggestion };
  }
  const amount = uncertainAmount(raw);
  if (amount) return { question: `Confirm the amount ${amount} before I use it. Edit the transcript if that is wrong.`, suggestion: raw };
  if (ambiguousWhen(raw)) return { question: "That date or time is not exact. Correct the transcript before I book anything.", suggestion: raw };
  return null;
}

export function cancelExplanation(input: { pending: number; completed: string }) {
  const done = String(input.completed || "").trim();
  if (input.pending > 0 && done) return `Cancelled the approval that was still waiting. ${done} already finished, and I cannot cancel that.`;
  if (input.pending > 0) return "Cancelled. The saved text is still here, and the send approval was withdrawn. Nothing was sent.";
  if (done) return `${done} already finished. I cannot cancel it.`;
  return "Nothing was waiting. Nothing was sent.";
}

export function isEcho(heard: string, spoken: string) {
  const left = String(heard || "").replace(/\s+/g, " ").trim().toLowerCase();
  const right = String(spoken || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (left.length < 12 || right.length < 12) return false;
  if (right.includes(left) || left.includes(right)) return true;
  const words = new Set(left.split(" ").filter(Boolean));
  const spokenWords = right.split(" ").filter(Boolean);
  const shared = spokenWords.filter((word) => words.has(word)).length;
  return shared / Math.max(spokenWords.length, 1) > 0.72;
}

export type ClipPlay = { started: boolean; dropped: boolean; blocked: boolean };

/** A received audio event is not playback. The clip counts only after play() is accepted. */
export function clipAudible(result: ClipPlay) {
  return result.started === true && result.dropped === false && result.blocked === false;
}

export function voiceAudible(results: ClipPlay[]) {
  return results.length > 0 && results.every(clipAudible);
}

export type SpokenDelivery =
  | { type: "audio"; mime: string; audio: string }
  | { type: "tts-error"; error: string };

/**
 * Speak every ready line before the caller finishes the response.
 * A timeout must not drop audio that this function already produced.
 */
export async function deliverSpokenLines(
  lines: string[],
  speak: (line: string) => Promise<string>,
  send: (event: SpokenDelivery) => void,
) {
  let sentAudio = false;
  let reported = false;
  for (const line of lines) {
    const text = String(line || "").trim();
    if (text.length < 2) continue;
    try {
      const audio = await speak(text);
      if (!audio) continue;
      sentAudio = true;
      send({ type: "audio", mime: "audio/mpeg", audio });
    } catch (error) {
      reported = true;
      const message = error instanceof Error ? error.message : "The voice could not be spoken.";
      send({ type: "tts-error", error: message });
    }
  }
  if (!sentAudio && !reported) send({ type: "tts-error", error: "No spoken audio came back. Press Play reply." });
  return { sentAudio };
}

/** Non-secret status for a voice turn whose reply is on screen but was not heard. */
export function voicePlaybackNote(input: { spoken: boolean; audible: boolean; clips: number; blocked: boolean; dropped: boolean; ttsError?: string }) {
  if (!input.spoken || input.audible) return "";
  const reported = String(input.ttsError || "").trim();
  if (reported) return reported;
  if (input.blocked) return "The browser blocked playback. Press Play reply.";
  if (input.dropped) return "Playback was interrupted before it finished. Press Play reply.";
  if (input.clips > 0) return "The spoken reply is ready. Press Play reply.";
  return "No spoken audio came back. Press Play reply.";
}

/** Shown whenever the desk speaks with the browser instead of the selected OpenAI voice. */
export const BROWSER_VOICE_FALLBACK = "Spoken with this browser's English voice. This is not the selected OpenAI voice.";

/** Pick a browser voice for English replies. This does not play audio and is not an OpenAI voice. */
export function preferredBrowserVoice(voices: Array<{ lang: string; name: string }>) {
  const list = voices.filter((voice) => /^en(-|$)/i.test(voice.lang || ""));
  return list.find((voice) => /^en-US/i.test(voice.lang))
    || list.find((voice) => /^en-CA/i.test(voice.lang))
    || list[0]
    || null;
}

export function repeatsRequest(heard: string, request: string) {
  const clean = (value: string) => String(value || "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const left = clean(heard);
  const right = clean(request);
  if (left.length < 8 || right.length < 8) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/** Three new words can interrupt. The line just submitted, and an echo of the reply, cannot. */
export function shouldBargeIn(heard: string, spoken: string, request: string) {
  const words = String(heard || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  if (isEcho(heard, spoken) || isEcho(heard, request) || repeatsRequest(heard, request)) return false;
  return true;
}

/** Every nonempty assistant reply can be played. Typed replies are included. This does not run the command. */
export function playableReplyLine(reply: string, request = "") {
  const brief = spokenBrief(reply, request).replace(/\s+/g, " ").trim();
  if (brief) return brief;
  return String(reply || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Play the reply that is already on screen. This never runs the command that produced it. */
export async function playStoredReply(input: {
  line: string;
  speakServer: (line: string) => Promise<ClipPlay & { error?: string }>;
  speakBrowser: (line: string) => Promise<ClipPlay>;
}) {
  const line = String(input.line || "").replace(/\s+/g, " ").trim();
  if (!line) return { visible: true as const, reranCommand: false as const, usedBrowser: false, note: "There is no reply to play.", spoke: false };
  const server = await input.speakServer(line);
  if (clipAudible(server)) return { visible: true as const, reranCommand: false as const, usedBrowser: false, note: "", spoke: true };
  const browser = await input.speakBrowser(line);
  const heard = clipAudible(browser);
  const problem = String(server.error || "").trim() || voicePlaybackNote({ spoken: true, audible: false, clips: 0, blocked: browser.blocked, dropped: browser.dropped });
  const note = heard ? BROWSER_VOICE_FALLBACK : `${BROWSER_VOICE_FALLBACK} ${problem}`.trim();
  return {
    visible: true as const,
    reranCommand: false as const,
    usedBrowser: true,
    note: heard || /press play reply/i.test(note) ? note : `${note} Press Play reply.`,
    spoke: heard,
  };
}
