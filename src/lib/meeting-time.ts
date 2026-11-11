export const ADVISOR_ZONES = [
  ["America/Toronto", "Toronto"],
  ["America/Halifax", "Halifax"],
  ["America/St_Johns", "Newfoundland"],
  ["America/Winnipeg", "Winnipeg"],
  ["America/Edmonton", "Edmonton"],
  ["America/Vancouver", "Vancouver"],
  ["America/New_York", "New York"],
  ["America/Chicago", "Chicago"],
  ["America/Denver", "Denver"],
  ["America/Los_Angeles", "Los Angeles"],
  ["UTC", "UTC"],
] as const;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function safeZone(value: string) {
  const zone = value.trim() || "America/Toronto";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "America/Toronto";
  }
}

export function zoneName(timeZone: string) {
  const found = ADVISOR_ZONES.find((item) => item[0] === timeZone);
  return found ? found[1] : timeZone.replace(/_/g, " ");
}

function parts(date: Date, timeZone: string) {
  const list = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => list.find((part) => part.type === type)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday,
  };
}

export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let delta = -20; delta <= 20; delta += 1) {
    const trial = new Date(guess.getTime() + delta * 3600000);
    const clock = parts(trial, timeZone);
    if (clock.year === year && clock.month === month && clock.day === day && clock.hour === hour && clock.minute === minute) return trial;
  }
  return null;
}

export function localClock(date: Date, timeZone: string) {
  const clock = parts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}:00`;
}

export function formatMeetingSpan(start: Date, minutes: number, timeZone: string) {
  if (Number.isNaN(start.getTime())) return "";
  const zone = safeZone(timeZone);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(start);
  const length = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  const end = new Date(start.getTime() + length * 60_000);
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const read = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((part) => part.type === type)?.value || "";
  const startParts = clock.formatToParts(start);
  const endParts = clock.formatToParts(end);
  const startMark = read(startParts, "dayPeriod");
  const endMark = read(endParts, "dayPeriod");
  const startClock = `${read(startParts, "hour")}:${read(startParts, "minute")}`;
  const endClock = `${read(endParts, "hour")}:${read(endParts, "minute")}`;
  const range = startMark === endMark ? `${startClock}–${endClock} ${endMark}` : `${startClock} ${startMark}–${endClock} ${endMark}`;
  return `${day} · ${range}`.replace(/\s+/g, " ").trim();
}

export function meetingLabel(date: Date, timeZone: string) {
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const spoken = text.replace(/,\s+(\d{1,2}:\d{2}\s*[AP]M)$/i, " at $1");
  return `${spoken} ${zoneName(timeZone)} time`;
}

function addDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function deskDayWindow(now: Date, timeZone: string) {
  const zone = safeZone(timeZone);
  const today = parts(now, zone);
  const tomorrow = addDays(today.year, today.month, today.day, 1);
  const after = addDays(today.year, today.month, today.day, 2);
  const pad = (value: number) => String(value).padStart(2, "0");
  const key = (part: { year: number; month: number; day: number }) => `${part.year}-${pad(part.month)}-${pad(part.day)}`;
  const start = zonedInstant(today.year, today.month, today.day, 0, 0, zone) || now;
  const end = zonedInstant(after.year, after.month, after.day, 0, 0, zone) || new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const midnight = zonedInstant(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, zone) || end;
  return { timeZone: zone, today: key(today), tomorrow: key(tomorrow), start, end, midnight };
}

export function onDeskDays(start: Date, now: Date, timeZone: string) {
  if (Number.isNaN(start.getTime())) return false;
  const window = deskDayWindow(now, timeZone);
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: window.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  return key === window.today || key === window.tomorrow;
}

export function msUntilZoneMidnight(now: Date, timeZone: string) {
  const midnight = deskDayWindow(now, timeZone).midnight;
  return Math.max(1000, midnight.getTime() - now.getTime());
}

function clockHour(hour: number, minute: number, marker: string) {
  const mark = marker.toLowerCase();
  if (mark.startsWith("p")) return { hour: hour === 12 ? 12 : hour + 12, minute };
  if (mark.startsWith("a")) return { hour: hour === 12 ? 0 : hour, minute };
  if (hour >= 13 && hour <= 23) return { hour, minute };
  if (hour >= 1 && hour <= 7) return { hour: hour + 12, minute };
  return { hour, minute };
}

function readTime(text: string) {
  const marked = [...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi)];
  const at = [...text.matchAll(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/gi)];
  const clock = [...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*o'?clock\b/gi)];
  const hit = marked.at(-1) || at.at(-1) || clock.at(-1);
  if (hit) {
    const hour = Number(hit[1]);
    const minute = Number(hit[2] || "0");
    if (hour > 23 || minute > 59) return null;
    return clockHour(hour, minute, hit[3] || "");
  }
  const iso = text.match(/\b20\d{2}-\d{2}-\d{2}[T ](\d{2}):(\d{2})\b/);
  if (!iso) return null;
  const hour = Number(iso[1]);
  const minute = Number(iso[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function readDay(text: string, now: Date, timeZone: string, hour: number, minute: number) {
  const today = parts(now, timeZone);
  const lower = text.toLowerCase();
  if (/\btomorrow\b/.test(lower)) return addDays(today.year, today.month, today.day, 1);
  if (/\b(today|tonight)\b/.test(lower)) return { year: today.year, month: today.month, day: today.day };
  const iso = lower.match(/\b(20\d{2})-(\d{2})-(\d{2})(?!\d)/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const monthName = lower.match(new RegExp(`\\b(${MONTHS.join("|")}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?\\b`));
  if (monthName) {
    const word = monthName[1].slice(0, 3);
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(word) + 1;
    const year = monthName[3] ? Number(monthName[3]) : today.year;
    return { year, month, day: Number(monthName[2]) };
  }
  const numeric = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}|\d{2}))?\b/);
  if (numeric) {
    const year = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : today.year;
    return { year, month: Number(numeric[1]), day: Number(numeric[2]) };
  }
  const weekday = lower.match(new RegExp(`\\b(next|this)?\\s*(${WEEKDAYS.join("|")})\\b`));
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2] as (typeof WEEKDAYS)[number]);
    let delta = (target - today.weekday + 7) % 7;
    const stillToday = delta === 0 && (hour > today.hour || (hour === today.hour && minute > today.minute));
    if (delta === 0 && !stillToday) delta = 7;
    if (weekday[1] === "next" && delta === 0) delta = 7;
    return addDays(today.year, today.month, today.day, delta);
  }
  return null;
}

export function resolveMeetingWhen(text: string, timeZone: string, now = new Date()) {
  const zone = safeZone(timeZone);
  const time = readTime(text);
  if (!time) return { ok: false as const, error: "What time should I use? For example, tomorrow at 3." };
  const day = readDay(text, now, zone, time.hour, time.minute);
  if (!day || day.month < 1 || day.month > 12 || day.day < 1 || day.day > 31) {
    return { ok: false as const, error: "Which day should I use? For example, tomorrow or next Tuesday." };
  }
  const instant = zonedInstant(day.year, day.month, day.day, time.hour, time.minute, zone);
  if (!instant) return { ok: false as const, error: "I could not read that date and time. Please say the day and time again." };
  return {
    ok: true as const,
    instant,
    local: localClock(instant, zone),
    label: meetingLabel(instant, zone),
    timeZone: zone,
    past: instant.getTime() <= now.getTime(),
  };
}

export function assistantClock(now: Date, timeZone: string) {
  const zone = safeZone(timeZone);
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  const spoken = when.replace(/,\s+(\d{1,2}:\d{2}\s*[AP]M)$/i, " at $1");
  const tomorrow = resolveMeetingWhen("tomorrow at 3:00 PM", zone, now);
  const tomorrowText = tomorrow.ok ? tomorrow.label : "the next calendar day";
  return `Current date and time, computed on the server just now: ${spoken}. Time zone: ${zone} (${zoneName(zone)}). Tomorrow at 3:00 PM is ${tomorrowText}. Do not guess today's date. Count today, tomorrow, and weekdays from this clock only. Never call today tomorrow.`;
}

export function confirmAsk(minutes: number, name: string, label: string) {
  const length = Math.min(180, Math.max(15, Number(minutes) || 30));
  return `Just to confirm: a ${length}-minute Zoom meeting with ${name} on ${label}. Shall I book it?`;
}

export function tidyMeetingTitle(title: string) {
  const match = title.match(/^(.*)\s+with\s+(.+)$/i);
  if (match && match[1].toLowerCase().endsWith(match[2].toLowerCase())) return `Zoom meeting with ${match[2]}`;
  return title;
}

export function zoomMeetingTitle(name: string, topic?: string) {
  const person = name.trim() || "client";
  const given = String(topic || "").replace(/\s+/g, " ").trim();
  if (!given || /^meeting with\b/i.test(given)) return `Zoom meeting with ${person}`;
  const tidy = tidyMeetingTitle(given);
  return tidy;
}

export function hasMeetingWhen(text: string) {
  return /\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[/-]\d{1,2}|20\d{2}-\d{2}-\d{2}|\bat\s+\d|\d(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i.test(text);
}

export function isTimeAgreement(text: string) {
  const trimmed = text.trim();
  if (!trimmed || hasMeetingWhen(trimmed)) return false;
  return /^(yes|yeah|yep|yup|ok|okay|confirm|confirmed|go ahead|book it|that works|do it|please|sure|correct|right|sounds good|that(?:'s| is) (?:right|correct))\b/i.test(trimmed);
}
