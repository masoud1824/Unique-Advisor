import { renderMeetingEletter, type EletterDesign } from "./eletter.ts";
import { zoneName } from "./meeting-time.ts";
import { signatureLines, type NewsletterContact } from "./newsletter.ts";
import { websiteButtonHtml, websiteButtonText, websiteHref } from "./advisor-website.ts";

export type MeetingLetterInput = {
  kind: "confirm" | "reminder" | "cancel";
  audience: "client" | "advisor";
  clientName: string;
  advisorName: string;
  advisorTitle?: string;
  advisorPhone?: string;
  advisorEmail?: string;
  advisorCompany?: string;
  advisorWebsite?: string;
  photoSrc?: string;
  topic: string;
  whenUtc: string;
  timeZone: string;
  minutes: number;
  join?: string;
  meetingId?: string;
  passcode?: string;
  icsUrl?: string;
  icsToken?: string;
  design?: EletterDesign;
};

function esc(value: string) {
  return value.replace(/&/g, "&" + "amp;").replace(/</g, "&" + "lt;").replace(/>/g, "&" + "gt;").replace(/"/g, "&" + "quot;");
}

function parts(whenUtc: string, timeZone: string) {
  const instant = new Date(whenUtc);
  const zone = timeZone || "America/Toronto";
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options }).format(instant);
  const generic = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value || "Eastern Time";
  const city = zoneName(zone);
  const zoneLabel = generic.toLowerCase().includes(city.toLowerCase()) ? generic : `${generic} (${city})`;
  return {
    day: format({ weekday: "long" }),
    date: format({ month: "long", day: "numeric", year: "numeric" }),
    time: format({ hour: "numeric", minute: "2-digit" }),
    zone: zoneLabel,
  };
}

function stamp(instant: Date) {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function formatAdvisorPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value.trim();
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export function zoomLetterTopic(clientName: string, topic: string) {
  const person = clientName.trim() || "client";
  const given = topic.replace(/\s+/g, " ").trim();
  if (!given || /^meeting with\b/i.test(given)) return `Zoom meeting with ${person}`;
  return given;
}

export function meetingIcs(input: { uid: string; whenUtc: string; minutes: number; topic: string; join: string; cancelled?: boolean }) {
  const start = new Date(input.whenUtc);
  const end = new Date(start.getTime() + Math.max(15, input.minutes || 30) * 60_000);
  const method = input.cancelled ? "CANCEL" : "PUBLISH";
  const status = input.cancelled ? "CANCELLED" : "CONFIRMED";
  const summary = (input.topic || "Meeting").replace(/[\r\n,;]/g, " ");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Unique Advisor//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${summary}`,
    `STATUS:${status}`,
  ];
  if (input.join && !input.cancelled) lines.push(`URL:${input.join}`);
  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

function shortWhen(whenUtc: string, timeZone: string) {
  const instant = new Date(whenUtc);
  const zone = timeZone || "America/Toronto";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(instant);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" }).format(instant);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(instant);
  return `${day}, ${date}, ${time}`;
}

export function buildMeetingLetter(input: MeetingLetterInput) {
  const client = input.clientName.trim() || "there";
  const advisor = input.advisorName.trim() || "Your advisor";
  const clock = parts(input.whenUtc, input.timeZone);
  const duration = `${Math.max(15, Number(input.minutes) || 30)} minutes`;
  const greeting = input.audience === "advisor" ? advisor : client;
  const topic = zoomLetterTopic(client, input.topic || "");
  const mailTopic = input.audience === "client" ? `Zoom meeting with ${advisor}` : topic;
  const intro = input.kind === "cancel"
    ? input.audience === "advisor"
      ? `The meeting with ${client} has been cancelled.`
      : "Your meeting has been cancelled. You do not need to attend."
    : input.kind === "reminder"
      ? input.audience === "advisor"
        ? `This is a reminder of your meeting with ${client}.`
        : "This is a reminder of our scheduled meeting."
      : input.audience === "advisor"
        ? `This is your copy of the meeting confirmation with ${client}.`
        : "Your meeting is confirmed. I look forward to speaking with you.";
  const join = (input.join || "").trim();
  const safeJoin = /^https:\/\/[\w.-]*zoom\.us\//i.test(join) ? join : "";
  const rows = [
    ["Day", clock.day],
    ["Date", clock.date],
    ["Time", clock.time],
    ["Time zone", clock.zone],
    ["Duration", duration],
    ["Subject", mailTopic || "Zoom meeting"],
  ];
  if (input.meetingId) rows.push(["Meeting ID", input.meetingId]);
  if (input.passcode) rows.push(["Passcode", input.passcode]);
  const detailText = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const detailHtml = rows.map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;font-weight:700;vertical-align:top">${esc(label)}</td><td style="padding:6px 0">${esc(value)}</td></tr>`).join("");
  const buttonColor = input.design === "azure" ? "#0e4da8" : input.design === "coral" ? "#c4553c" : input.design === "emerald" ? "#0f6b4c" : input.design === "sunset" ? "#c2416b" : input.design === "ruled" ? "#7a5b32" : "#5c1a4a";
  const button = safeJoin && input.kind !== "cancel"
    ? `<p style="margin:22px 0 8px"><a href="${esc(safeJoin)}" style="display:inline-block;background:${buttonColor};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:6px">Join Zoom Meeting</a></p><p style="margin:0 0 16px">You can also <a href="${esc(safeJoin)}">click here to join</a>.</p>`
    : "";
  const calendar = input.icsUrl && input.kind !== "cancel"
    ? `<p style="margin:0 0 16px"><a href="${esc(input.icsUrl)}">Add to calendar</a></p>`
    : "";
  const closing = input.kind === "cancel"
    ? "If you would like to choose another time, reply to this email and I will send a new invitation."
    : "If this time no longer suits you, reply to this email and I will be glad to reschedule.";
  const firm = (input.advisorCompany || "").trim();
  const company = firm && firm.toLowerCase() !== advisor.toLowerCase() ? firm : "";
  const phone = formatAdvisorPhone(input.advisorPhone || "");
  const site = websiteHref(input.advisorWebsite || "");
  const signature = signatureLines({
    name: advisor,
    title: input.advisorTitle,
    company: input.advisorCompany,
    phone,
    email: input.advisorEmail,
    website: "",
  });
  if (site) signature.push(websiteButtonText(site));
  const sign = `Warm regards,\n${signature.join("\n")}`;
  const signHtml = `Warm regards,<br>${signature.filter((line) => !/^visit my website\b/i.test(line)).map((line) => esc(line)).join("<br>")}${site ? websiteButtonHtml(site) : ""}`;
  const purpose = input.kind === "cancel" ? "to tell you a scheduled meeting was cancelled" : input.kind === "reminder" ? "to remind you of a scheduled meeting" : "to confirm a scheduled meeting";
  const compliance = `This message was sent by ${advisor}${company ? `, ${company}` : ""} ${purpose}. Please reply if you were not expecting it.`;
  const text = [
    `Dear ${greeting},`,
    "",
    intro,
    "",
    detailText,
    "",
    input.kind === "cancel" ? "" : "Join Zoom Meeting from the button in this email.",
    input.icsUrl && input.kind !== "cancel" ? `Add to calendar: ${input.icsUrl}` : "",
    "",
    closing,
    "",
    sign,
    "",
    compliance,
  ].filter((line) => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
  const htmlBody = `<p>Dear ${esc(greeting)},</p><p>${esc(intro)}</p><table role="presentation" style="margin:16px 0;border-collapse:collapse">${detailHtml}</table>${button}${calendar}<p>${esc(closing)}</p><p>${signHtml}</p>`;
  const contact: NewsletterContact = {
    name: advisor,
    title: input.advisorTitle || "",
    phone: input.advisorPhone || "",
    email: input.advisorEmail || "",
    place: company,
    website: input.advisorWebsite || "",
  };
  const title = input.kind === "cancel" ? "Meeting cancelled" : input.kind === "reminder" ? "Meeting reminder" : "Meeting confirmed";
  const html = renderMeetingEletter({
    design: input.design || "plum",
    kicker: input.kind === "cancel" ? "Cancellation" : "Meeting",
    title,
    bodyHtml: htmlBody,
    contact,
    logoSrc: input.photoSrc || "",
    compliance,
  });
  const subject = input.kind === "cancel"
    ? `Meeting cancelled: ${mailTopic}`
    : input.kind === "reminder"
      ? `Reminder: ${mailTopic}`
      : `Zoom meeting with ${input.audience === "client" ? advisor : client} – ${shortWhen(input.whenUtc, input.timeZone)}`;
  const uid = `${(input.icsToken || input.meetingId || "meeting").replace(/[^\w.-]/g, "") || "meeting"}@uniqueadvisor`;
  const ics = input.whenUtc
    ? meetingIcs({ uid, whenUtc: input.whenUtc, minutes: input.minutes, topic, join: safeJoin, cancelled: input.kind === "cancel" })
    : "";
  return { subject, text, html, ics };
}
