import { safeZone, zoneName, zonedInstant } from "./meeting-time.ts";

export type CalendarRecord = {
  source: string;
  title: string;
  start: string;
  end?: string;
  id?: string;
  join?: string;
  location?: string;
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

const MONTH_NUMBERS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function datedKey(year: number, month: number, day: number, timeZone: string) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const instant = zonedInstant(year, month, day, 0, 0, timeZone);
  if (!instant) return "";
  const key = dayKey(instant, timeZone);
  const [gotYear, gotMonth, gotDay] = key.split("-").map(Number);
  return gotYear === year && gotMonth === month && gotDay === day ? key : "";
}

function explicitDayKeys(text: string, timeZone: string) {
  const keys: string[] = [];
  const add = (year: number, month: number, day: number) => {
    const key = datedKey(year, month, day, timeZone);
    if (key && !keys.includes(key)) keys.push(key);
  };
  const source = String(text || "");
  for (const match of source.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) add(Number(match[1]), Number(match[2]), Number(match[3]));
  const month = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
  for (const match of source.matchAll(new RegExp(`\\b(${month})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`, "gi"))) {
    add(Number(match[3]), MONTH_NUMBERS[match[1].toLowerCase()] || 0, Number(match[2]));
  }
  for (const match of source.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${month})\\.?,?\\s+(20\\d{2})\\b`, "gi"))) {
    add(Number(match[3]), MONTH_NUMBERS[match[2].toLowerCase()] || 0, Number(match[1]));
  }
  return keys;
}

export function calendarSpan(text: string, now: Date, timeZone: string): CalendarSpan {
  const zone = safeZone(timeZone);
  const today = dayKey(now, zone);
  const tidy = String(text || "").toLowerCase();
  const dates = explicitDayKeys(text, zone).sort();
  let startKey = dates[0] || today;
  let endKey = dates.length ? shiftKey(dates[dates.length - 1], 1) : shiftKey(today, 14);
  let label = dates.length === 1
    ? spokenDay(startKey, zone)
    : dates.length > 1
      ? `${spokenDay(startKey, zone)} through ${spokenDay(dates[dates.length - 1], zone)}`
      : "the next two weeks";
  if (!dates.length && /\btoday\b/.test(tidy)) {
    endKey = shiftKey(today, 1);
    label = `today, ${spokenDay(today, zone)}`;
  } else if (!dates.length && /\btomorrow\b/.test(tidy)) {
    startKey = shiftKey(today, 1);
    endKey = shiftKey(today, 2);
    label = `tomorrow, ${spokenDay(startKey, zone)}`;
  } else if (!dates.length && /\bthis week\b/.test(tidy)) {
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

function sameEvent(left: CalendarRecord, right: CalendarRecord) {
  const leftId = left.id?.trim() || "";
  const rightId = right.id?.trim() || "";
  if (leftId && rightId && leftId === rightId && left.source.toLowerCase() === right.source.toLowerCase()) return true;
  if (!left.start || !right.start) return false;
  if (Math.abs(Date.parse(left.start) - Date.parse(right.start)) > 2 * 60 * 1000) return false;
  const join = (item: CalendarRecord) => item.join?.replace(/\/$/, "").toLowerCase() || "";
  const sameTitle = left.title.trim().toLowerCase() === right.title.trim().toLowerCase();
  if (join(left) && join(left) === join(right) && (sameTitle || !left.title.trim() || !right.title.trim())) return true;
  if (!sameTitle) return false;
  const place = (item: CalendarRecord) => knownDetail(item.location).toLowerCase();
  if (place(left) && place(right) && place(left) !== place(right)) return false;
  if (left.source.toLowerCase() === right.source.toLowerCase()) return true;
  return [left.source, right.source].some((source) => source.toLowerCase() === "zoom");
}

function knownDetail(value?: string) {
  const text = String(value || "").trim();
  return text && text.toLowerCase() !== "unknown" ? text : "";
}

function combine(group: CalendarRecord[]): CalendarRecord {
  const first = [...group].sort((left, right) => left.start.localeCompare(right.start) || left.title.localeCompare(right.title))[0];
  const sources = [...new Set(group.map((item) => item.source).filter(Boolean))].sort();
  return {
    ...first,
    source: sources.join(" and "),
    title: first.title,
    location: group.map((item) => knownDetail(item.location)).find(Boolean) || "",
    join: group.map((item) => knownDetail(item.join)).find(Boolean) || "",
  };
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

function appointmentDate(start: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(start));
}

export function presentCalendar(span: CalendarSpan, items: CalendarRecord[]) {
  const kept = mergeCalendarItems(items.filter((item) => inCalendarSpan(item.start, span)));
  const lines = kept.flatMap((item) => [
    `- ${clock(item.start, span.timeZone)}: ${item.title}`,
    `  Date: ${appointmentDate(item.start, span.timeZone)}`,
    `  Source: ${item.source || "unknown"}`,
    `  Location: ${knownDetail(item.location) || "unknown"}`,
    `  Meeting link: ${knownDetail(item.join) || "unknown"}`,
  ]);
  const heading = kept.length
    ? `Appointments for ${span.label} (${zoneName(span.timeZone)} time):`
    : `No appointments for ${span.label} (${zoneName(span.timeZone)} time).`;
  return [heading, ...lines, `Range: ${span.start} to ${span.end} (${span.timeZone}).`, "Nothing on the calendar was changed."].join("\n");
}

export function listedAppointments(listing: string) {
  const rows: Array<{ time: string; title: string; source: string; location: string; link: string; date: string }> = [];
  const lines = String(listing || "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const head = lines[index].match(/^- (.*?): (.+?)(?: \(([^)\n]+)\))?$/);
    if (!head) continue;
    const row = { time: head[1].trim(), title: head[2].trim(), source: (head[3] || "").trim(), location: "", link: "", date: "" };
    for (let next = index + 1; next < lines.length; next += 1) {
      const extra = lines[next].match(/^\s+(Date|Source|Location|Meeting link): (.*)$/);
      if (!extra) break;
      const value = extra[2].trim();
      if (extra[1] === "Date") row.date = value;
      if (extra[1] === "Source" && !row.source) row.source = value;
      if (extra[1] === "Location") row.location = value;
      if (extra[1] === "Meeting link") row.link = value;
    }
    rows.push(row);
  }
  return rows;
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
  if (/\b(?:who can receive|which contacts can receive|eligible names|contact list|life insurance clients|exclusions?)\b/i.test(tidy) && /\b(?:clients?|contacts?|mail|email|eligible|exclusion|receive)\b/i.test(tidy)) return false;
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
  const place = row.location && row.location.toLowerCase() !== "unknown" ? row.location : "unknown";
  const link = row.link && row.link.toLowerCase() !== "unknown" ? row.link : "unknown";
  if (asksChecklist) {
    return [
      `Preparation checklist for ${row.title} at ${row.time}:`,
      `- Time: ${row.time}`,
      `- Location: ${place}`,
      `- Meeting link: ${link}`,
      "- Review the appointment title. The calendar source is not the location.",
      "- Note any documents the advisor still needs to bring. If none are listed, that is unknown.",
      "- Leave signatures and advice for the advisor.",
      "Nothing was saved or sent. No contact was searched.",
    ].join("\n");
  }
  const asksSummary = /\bsummar/i.test(text);
  if (asksSummary) return `${row.title} is at ${row.time}. Source: ${row.source || "unknown"}. Location: ${place}. Meeting link: ${link}.`;
  const asksTime = /\b(?:what time|when)\b/i.test(text);
  const asksWhere = /\b(?:where|location|address)\b/i.test(text);
  const asksWho = /\bwho\b/i.test(text);
  if (asksTime && asksWhere) return `${row.title} is at ${row.time}. Location: ${place}. Meeting link: ${link}.`;
  if (asksTime && asksWho) return `That appointment is ${row.title} at ${row.time}.`;
  if (asksTime) return `That appointment is at ${row.time}.`;
  if (asksWhere) return `Location: ${place}. Meeting link: ${link}.`;
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

export function appointmentGrounding(listing: string) {
  const rows = listedAppointments(listing);
  const records = rows.length
    ? rows.map((row, index) => [
      `Event ${index + 1}: ${row.title} at ${row.time}`,
      `Source: ${row.source || "unknown"}`,
      `Location: ${row.location || "unknown"}`,
      `Meeting link: ${row.link || "unknown"}`,
    ].join("\n")).join("\n\n")
    : "Event records: none.";
  return [
    "Appointment grounding: the latest question is about a retrieved appointment, not the current clock.",
    "Give the appointment time and place. Do not add the present time of day.",
    "If the conversation has not identified which appointment, and more than one is listed, ask which one.",
    "If the user says the first appointment, answer from Event 1 only. Second means Event 2. Do not ask which appointment after they named the position.",
    "Who it is with comes only from that event title. If the title is not a person's name, say the title and that the person is unknown.",
    "Where it is comes only from Location. Unknown stays unknown.",
    "Source is the calendar provider. It is never a location or a meeting link.",
    "If Location or Meeting link says unknown, answer unknown. Do not infer either from the source, the title, or an earlier assistant message.",
    "If an earlier reply invented a location or link, correct it from these records.",
    records,
  ].join("\n");
}
