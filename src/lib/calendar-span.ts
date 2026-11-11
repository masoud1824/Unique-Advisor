import { safeZone, zoneName, zonedInstant } from "./meeting-time.ts";

export type CalendarRecord = {
  source: string;
  title: string;
  start: string;
  end?: string;
  id?: string;
  join?: string;
};

export type CalendarSpan = {
  label: string;
  start: string;
  end: string;
  timeZone: string;
};

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftKey(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function atMidnight(key: string, timeZone: string) {
  const [year, month, day] = key.split("-").map(Number);
  return zonedInstant(year, month, day, 0, 0, timeZone)?.toISOString() || "";
}

function spokenDay(key: string, timeZone: string) {
  const instant = atMidnight(key, timeZone);
  if (!instant) return key;
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(instant));
}

export function calendarSpan(text: string, now: Date, timeZone: string): CalendarSpan {
  const zone = safeZone(timeZone);
  const today = dayKey(now, zone);
  const tidy = String(text || "").toLowerCase();
  let startKey = today;
  let endKey = shiftKey(today, 14);
  let label = "the next two weeks";
  if (/\btoday\b/.test(tidy)) {
    endKey = shiftKey(today, 1);
    label = `today, ${spokenDay(today, zone)}`;
  } else if (/\btomorrow\b/.test(tidy)) {
    startKey = shiftKey(today, 1);
    endKey = shiftKey(today, 2);
    label = `tomorrow, ${spokenDay(startKey, zone)}`;
  } else if (/\bthis week\b/.test(tidy)) {
    endKey = shiftKey(today, 7);
    label = "this week";
  }
  return { label, start: atMidnight(startKey, zone), end: atMidnight(endKey, zone), timeZone: zone };
}

export function inCalendarSpan(start: string, span: CalendarSpan) {
  const time = Date.parse(start);
  const from = Date.parse(span.start);
  const to = Date.parse(span.end);
  return Number.isFinite(time) && Number.isFinite(from) && Number.isFinite(to) && time >= from && time < to;
}

function titleWords(value: string) {
  return value.toLowerCase().replace(/\b(?:zoom|meeting|with|the|a|an)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2);
}

function titlesMatch(left: string, right: string) {
  const leftWords = titleWords(left);
  const rightWords = new Set(titleWords(right));
  if (!leftWords.length || !rightWords.size) return left.trim().toLowerCase() === right.trim().toLowerCase();
  const shared = leftWords.filter((word) => rightWords.has(word)).length;
  return shared > 0 && (shared >= Math.min(leftWords.length, rightWords.size) || shared >= 2);
}

function sameEvent(left: CalendarRecord, right: CalendarRecord) {
  const leftId = left.id?.trim() || "";
  const rightId = right.id?.trim() || "";
  if (leftId && leftId === rightId && left.source.toLowerCase() === right.source.toLowerCase()) return true;
  if (!left.start || !right.start) return false;
  if (Math.abs(Date.parse(left.start) - Date.parse(right.start)) > 2 * 60 * 1000) return false;
  const join = (item: CalendarRecord) => item.join?.replace(/\/$/, "").toLowerCase() || "";
  if (join(left) && join(left) === join(right)) return true;
  if (!titlesMatch(left.title, right.title)) return false;
  if (left.source.toLowerCase() === right.source.toLowerCase()) return true;
  return [left.source, right.source].some((source) => source.toLowerCase() === "zoom");
}

function combine(group: CalendarRecord[]): CalendarRecord {
  const first = [...group].sort((left, right) => left.start.localeCompare(right.start) || left.title.localeCompare(right.title))[0];
  const sources = [...new Set(group.map((item) => item.source).filter(Boolean))].sort();
  return { ...first, source: sources.join(" and "), title: first.title };
}

export function mergeCalendarItems(items: CalendarRecord[]) {
  const groups: CalendarRecord[][] = [];
  for (const item of items) {
    const found = groups.find((group) => group.some((current) => sameEvent(current, item)));
    if (found) found.push(item);
    else groups.push([item]);
  }
  return groups.map(combine).sort((left, right) => left.start.localeCompare(right.start) || left.title.localeCompare(right.title));
}

function clock(start: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(start));
}

export function presentCalendar(span: CalendarSpan, items: CalendarRecord[]) {
  const kept = mergeCalendarItems(items.filter((item) => inCalendarSpan(item.start, span)));
  const lines = kept.map((item) => `- ${clock(item.start, span.timeZone)}: ${item.title} (${item.source})`);
  const heading = kept.length
    ? `Appointments for ${span.label} (${zoneName(span.timeZone)} time):`
    : `No appointments for ${span.label} (${zoneName(span.timeZone)} time).`;
  return [heading, ...lines, `Range: ${span.start} to ${span.end} (${span.timeZone}).`, "Nothing on the calendar was changed."].join("\n");
}

export function listedAppointments(listing: string) {
  return [...String(listing || "").matchAll(/^- (.*?): (.+?) \(([^)\n]+)\)/gm)].map((match) => ({
    time: match[1].trim(),
    title: match[2].trim(),
    source: match[3].trim(),
  }));
}

export function isCalendarListing(text: string) {
  return /^(?:Appointments|No appointments|Calendar) for /m.test(String(text || ""));
}

export function calendarListingFromThread(thread: Array<{ role?: string; content?: string }>) {
  const messages = (thread || []).filter((turn) => turn.role === "assistant" && isCalendarListing(String(turn.content || "")));
  const withEvents = [...messages].reverse().find((turn) => listedAppointments(String(turn.content || "")).length);
  return String((withEvents || messages[messages.length - 1])?.content || "");
}

export function refersToAppointment(text: string) {
  const tidy = String(text || "");
  const pointsBack = /\b(?:it|that|this|those|the appointment|the meeting)\b/i.test(tidy);
  const asksTime = /\b(?:what time|when is|what time is it)\b/i.test(tidy);
  const asksWho = /\bwho\b/i.test(tidy) && /\b(?:with|for|appointment|meeting|it|that)\b/i.test(tidy);
  const asksSummary = /\bsummar/i.test(tidy) && /\b(?:appointment|meeting|it|that|those|calendar)\b/i.test(tidy);
  const asksChecklist = /\b(?:checklist|preparation)\b/i.test(tidy) && /\b(?:it|that|appointment|meeting)\b/i.test(tidy);
  return asksTime || asksWho || asksSummary || asksChecklist || (pointsBack && /\b(?:appointment|meeting|time|who)\b/i.test(tidy));
}

export function answerAboutAppointment(text: string, listing: string) {
  const rows = listedAppointments(listing);
  if (!rows.length) return "The last calendar result in this conversation has no appointments. Ask me to show today's appointments and I will retrieve them again. I did not search contacts.";
  const named = rows.filter((row) => text.toLowerCase().includes(row.title.toLowerCase()));
  const chosen = named.length === 1 ? named : rows;
  if (chosen.length > 1) {
    const choices = chosen.map((row) => `${row.title} at ${row.time}`).join(", or ");
    return `Which appointment? ${choices}?`;
  }
  const row = chosen[0];
  const asksChecklist = /\b(?:checklist|preparation)\b/i.test(text);
  if (asksChecklist) {
    return [
      `Preparation checklist for ${row.title} at ${row.time}:`,
      "- Confirm the time shown on the calendar",
      "- Review the appointment title and where it is listed",
      "- Note any documents the advisor still needs to bring",
      "- Leave signatures and advice for the advisor",
      "Nothing was saved or sent. No contact was searched.",
    ].join("\n");
  }
  const asksSummary = /\bsummar/i.test(text);
  if (asksSummary) return `${row.title} is at ${row.time} (${row.source}).`;
  const asksTime = /\b(?:what time|when)\b/i.test(text);
  const asksWho = /\bwho\b/i.test(text);
  if (asksTime && asksWho) return `That appointment is ${row.title} at ${row.time}.`;
  if (asksTime) return `That appointment is at ${row.time}.`;
  if (asksWho) return `That appointment is listed as ${row.title}.`;
  return `${row.title} is at ${row.time}.`;
}

export function isCalendarSummary(text: string) {
  return /\bsummar/i.test(text) && /\b(?:those|these|them|appointment|meeting|calendar|schedule)\b/i.test(text);
}

export function summarizeListedAppointments(listing: string) {
  const label = listing.match(/^(?:Appointments|No appointments) for (.+?) \(/m)?.[1] || "that day";
  const rows = listedAppointments(listing);
  const unique = rows.filter((row, index) => rows.findIndex((item) => item.time === row.time && item.title === row.title) === index);
  if (!unique.length) return `There are no appointments for ${label}.`;
  const parts = unique.map((row) => `${row.title} at ${row.time}`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  const lead = label.charAt(0).toUpperCase() + label.slice(1);
  return `${lead} includes ${list}.`;
}
