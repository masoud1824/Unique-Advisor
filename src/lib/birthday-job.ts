/** Birthday check. Live sending stays off. Tests use a fake clock and a fake delivery result. */

export type Feb29Policy = "skip" | "march1";
export type BirthdaySource = "desk" | "dropbox" | "";
export type DeliveryStatus = "accepted" | "failed" | "unknown" | "skipped";

export type BirthdayPerson = {
  contactId: string;
  name: string;
  email: string;
  birthday: string;
  unsubscribed: boolean;
};

export type BirthdayClaim = {
  key: string;
  status: DeliveryStatus | "claimed";
  providerId: string;
};

export type BirthdaySettings = {
  enabled: boolean;
  source: BirthdaySource;
  timezone: string;
  feb29: Feb29Policy;
  templateVersion: number;
  confirmedVersion: number;
  cardTitle: string;
};

export type ZonedParts = { year: string; month: string; day: string; hour: string; minute: string; date: string };

export function zonedParts(now: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    year: bag.year,
    month: bag.month,
    day: bag.day,
    hour: bag.hour,
    minute: bag.minute,
    date: `${bag.year}-${bag.month}-${bag.day}`,
  };
}

export function yesterday(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function isLeap(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function birthdayMonthDay(birthday: string): { month: string; day: string } | null {
  const text = String(birthday || "").trim();
  const full = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const partial = text.match(/^(?:--)?(\d{2})-(\d{2})$/);
  const match = full ? [full[2], full[3]] : partial ? [partial[1], partial[2]] : null;
  if (!match) return null;
  const month = Number(match[0]);
  const day = Number(match[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month: String(month).padStart(2, "0"), day: String(day).padStart(2, "0") };
}

export function personHasBirthday(person: BirthdayPerson, local: ZonedParts, feb29: Feb29Policy): boolean {
  const parts = birthdayMonthDay(person.birthday);
  if (!parts) return false;
  if (parts.month === "02" && parts.day === "29" && !isLeap(Number(local.year))) {
    return feb29 === "march1" && local.month === "03" && local.day === "01";
  }
  return parts.month === local.month && parts.day === local.day;
}

export function claimKey(advisorId: number, contactId: string, year: string) {
  return `${advisorId}:${contactId}:birthday:${year}`;
}

export function missingBirthdayKey(advisorId: number, contactId: string) {
  return `${advisorId}:${contactId}:missing-birthday`;
}

export function previewBirthdayCard(template: string, person: Pick<BirthdayPerson, "name">) {
  const text = String(template || "Happy birthday, {{name}}.").replaceAll("{{name}}", person.name).slice(0, 2000);
  return { text, live: false as const, sent: false as const };
}

function uniquePeople(people: BirthdayPerson[]) {
  const seen = new Set<string>();
  const unique: BirthdayPerson[] = [];
  const duplicateContactIds: string[] = [];
  for (const person of people) {
    if (seen.has(person.contactId)) {
      duplicateContactIds.push(person.contactId);
      continue;
    }
    seen.add(person.contactId);
    unique.push(person);
  }
  return { unique, duplicateContactIds };
}

export function runWindow(local: ZonedParts, lastRunDate: string): "run" | "too_early" | "missed_days" | "already_today" {
  if (lastRunDate === local.date) return "already_today";
  const hour = Number(local.hour);
  const minute = Number(local.minute);
  const inMorning = hour === 9 && minute < 15;
  const sameDayCatchUp = hour > 9 && hour < 15 && lastRunDate === yesterday(local.date);
  if (inMorning) return "run";
  if (sameDayCatchUp) return "run";
  if (lastRunDate && lastRunDate < yesterday(local.date) && hour >= 9) return "missed_days";
  return "too_early";
}

export type PlannedRecipient = {
  contactId: string;
  name: string;
  email: string;
  action: "send" | "skip" | "retry" | "hold";
  reason: string;
};

export function planBirthdayRun(input: {
  advisorId: number;
  settings: BirthdaySettings;
  people: BirthdayPerson[];
  claims: BirthdayClaim[];
  now: Date;
  lastRunDate: string;
}): {
  window: ReturnType<typeof runWindow>;
  local: ZonedParts;
  recipients: PlannedRecipient[];
  notice: string;
  missingDates: Array<{ contactId: string; name: string; repeat: boolean }>;
  duplicateContactIds: string[];
} {
  const zone = input.settings.timezone || "America/Toronto";
  const local = zonedParts(input.now, zone);
  const { unique, duplicateContactIds } = uniquePeople(input.people);
  const claims = new Map(input.claims.map((claim) => [claim.key, claim]));
  const missingDates = unique
    .filter((person) => !birthdayMonthDay(person.birthday))
    .map((person) => ({
      contactId: person.contactId,
      name: person.name,
      repeat: claims.has(missingBirthdayKey(input.advisorId, person.contactId)),
    }));
  const freshMissing = missingDates.filter((item) => !item.repeat);
  const missingLine = freshMissing.length
    ? `Missing birthday dates, shown once: ${freshMissing.map((item) => item.name).join(", ")}. No birthday was guessed.`
    : "";
  if (!input.settings.enabled) {
    return { window: "too_early", local, recipients: [], missingDates, duplicateContactIds, notice: "Birthday cards are off. Nothing is scheduled." };
  }
  if (input.settings.confirmedVersion !== input.settings.templateVersion) {
    return { window: "too_early", local, recipients: [], missingDates, duplicateContactIds, notice: "The card or sender changed. Turn the birthday check on again to confirm the new version. Nothing was sent." };
  }
  if (input.settings.source !== "desk" && input.settings.source !== "dropbox") {
    return { window: "too_early", local, recipients: [], missingDates, duplicateContactIds, notice: "Choose Unique Advisor contacts or one Dropbox file before birthday cards can run. No birthdays were guessed." };
  }
  const window = runWindow(local, input.lastRunDate);
  if (window !== "run") {
    const notice = [
      window === "missed_days"
        ? "Missed days were not sent. Only today's 9:00 check can send, and it does not go back through old birthdays."
        : window === "already_today"
          ? "Today's birthday check already ran."
          : "It is not 9:00 in the advisor's time zone yet.",
      missingLine,
    ].filter(Boolean).join(" ");
    return { window, local, recipients: [], missingDates, duplicateContactIds, notice };
  }
  const recipients: PlannedRecipient[] = [];
  for (const person of unique) {
    if (!personHasBirthday(person, local, input.settings.feb29)) continue;
    const key = claimKey(input.advisorId, person.contactId, local.year);
    const prior = claims.get(key);
    if (person.unsubscribed) {
      recipients.push({ contactId: person.contactId, name: person.name, email: person.email, action: "skip", reason: "unsubscribed" });
      continue;
    }
    if (!person.email.includes("@")) {
      recipients.push({ contactId: person.contactId, name: person.name, email: person.email, action: "skip", reason: "no email" });
      continue;
    }
    if (prior?.status === "accepted") {
      recipients.push({ contactId: person.contactId, name: person.name, email: person.email, action: "hold", reason: "already accepted this year" });
      continue;
    }
    if (prior?.status === "unknown") {
      recipients.push({ contactId: person.contactId, name: person.name, email: person.email, action: "hold", reason: "provider outcome unknown; not resent" });
      continue;
    }
    if (prior?.status === "failed") {
      recipients.push({ contactId: person.contactId, name: person.name, email: person.email, action: "retry", reason: "earlier attempt failed" });
      continue;
    }
    if (prior?.status === "claimed" || prior?.status === "skipped") {
      recipients.push({ contactId: person.contactId, name: person.name, email: person.email, action: "hold", reason: "already claimed" });
      continue;
    }
    recipients.push({ contactId: person.contactId, name: person.name, email: person.email, action: "send", reason: "due" });
  }
  const accepted = recipients.filter((item) => item.action === "hold" && item.reason === "already accepted this year").length;
  const notice = [
    recipients.length
      ? `This advisor has birthday results. Provider acceptance is not confirmed delivery. ${accepted} already accepted, ${recipients.length - accepted} not described as sent.`
      : "No birthdays today. No notice is required.",
    missingLine,
  ].filter(Boolean).join(" ");
  return { window, local, recipients, missingDates, duplicateContactIds, notice };
}

export function summarizeAdvisorNotice(recipients: Array<{ name: string; outcome: string }>) {
  if (recipients.length === 0) return "";
  const lines = recipients.map((item) => `${item.name}: ${item.outcome}`);
  const accepted = recipients.filter((item) => item.outcome === "accepted").length;
  const failed = recipients.length - accepted;
  return `Birthday check: ${accepted} accepted by the provider, ${failed} not accepted. Accepted is not confirmed delivery. ${lines.join("; ")}`;
}

export type BirthdayCardReport = "sent" | "not sent" | "failed" | "unavailable";

export function birthdayCardReport(status: string | null | undefined): BirthdayCardReport {
  if (status == null || status === "" || status === "skipped") return "not sent";
  if (status === "accepted") return "sent";
  if (status === "failed") return "failed";
  return "unavailable";
}

export function todaysBirthdayReport(input: {
  people: BirthdayPerson[];
  claims: Array<{ key: string; status: string }>;
  now: Date;
  timeZone: string;
  feb29: Feb29Policy;
  advisorId: number;
}) {
  const zone = input.timeZone || "America/Toronto";
  const local = zonedParts(input.now, zone);
  const claims = new Map(input.claims.map((claim) => [claim.key, claim.status]));
  const people = input.people
    .filter((person) => personHasBirthday(person, local, input.feb29))
    .map((person) => ({
      contactId: person.contactId,
      name: person.name,
      card: birthdayCardReport(claims.has(claimKey(input.advisorId, person.contactId, local.year)) ? claims.get(claimKey(input.advisorId, person.contactId, local.year)) : null),
    }));
  return { date: local.date, timeZone: zone, people };
}
