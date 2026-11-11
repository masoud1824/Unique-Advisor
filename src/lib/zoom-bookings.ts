import { deleteConnectedEvent } from "@/lib/calendar-delete";
import { contactMatchesQuery, resolveSpokenContact } from "@/lib/contact-match";
import { getSql } from "@/lib/db";
import { linkAccessToken, readCalendars, accessToken } from "@/lib/advisor-links";
import { writeContactLog } from "@/lib/contact-records";
import { accessTokenForAdvisor, graphSendMail } from "@/lib/microsoft-mail";
import { commitZoomBooking, meetingReply } from "@/lib/zoom-booking-commit";
import { hasMeetingWhen, isTimeAgreement, localClock, meetingLabel, resolveMeetingWhen, safeZone, confirmAsk, zoomMeetingTitle, deskDayWindow, onDeskDays, formatMeetingSpan } from "@/lib/meeting-time";
import { buildMeetingLetter, meetingIcs } from "@/lib/meeting-letter";
import { shownWebsite } from "@/lib/advisor-db";

export { meetingReply };

export const ZOOM_RULE = "Book Zoom meetings for contacts";
const STORES = ["dropbox", "box", "google_drive"] as const;
type Store = (typeof STORES)[number];
type ContactRow = { id: number; full_name: string; email: string };

async function ready() {
  const sql = await getSql();
  await sql.query(`create table if not exists zoom_bookings (
    id serial primary key,
    advisor_id integer not null,
    contact_id integer not null,
    contact_name text not null default '',
    contact_email text not null default '',
    topic text not null default '',
    start_at timestamptz not null,
    minutes integer not null default 30,
    join_url text not null default '',
    zoom_id text not null default '',
    reminded_day boolean not null default false,
    reminded_hour boolean not null default false,
    recording_state text not null default 'waiting',
    created_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists desk_notices (
    id serial primary key,
    advisor_id integer not null,
    body text not null,
    seen boolean not null default false,
    created_at timestamptz not null default now()
  )`);
  await sql.query("alter table advisors add column if not exists save_zoom_recordings boolean not null default true");
  await sql.query("alter table advisors add column if not exists file_store text not null default 'dropbox'");
  await sql.query("alter table advisors add column if not exists time_zone text not null default 'America/Toronto'");
  await sql.query(`create table if not exists desk_calendar_events (
    id serial primary key,
    advisor_id integer not null,
    source text not null,
    title text not null,
    start_at timestamptz not null,
    minutes integer not null default 30
  )`);
  await sql.query("alter table desk_calendar_events add column if not exists external_id text not null default ''");
  await sql.query(`create table if not exists zoom_pending (
    advisor_id integer primary key,
    contact_id integer not null,
    contact_name text not null,
    contact_email text not null,
    topic text not null,
    start_at timestamptz not null,
    local_start text not null,
    local_end text not null,
    time_zone text not null,
    label text not null,
    minutes integer not null
  )`);
  await sql.query(`create table if not exists zoom_booking_log (
    id serial primary key,
    advisor_id integer not null,
    step text not null,
    detail text not null,
    created_at timestamptz not null default now()
  )`);
  await sql.query("alter table zoom_bookings add column if not exists passcode text not null default ''");
  await sql.query("alter table zoom_bookings add column if not exists outlook_id text not null default ''");
  await sql.query("alter table zoom_bookings add column if not exists ics_token text not null default ''");
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Client";
}

export async function advisorZone(advisorId: number) {
  await ready();
  const row = (await (await getSql())<{ time_zone: string }>`select time_zone from advisors where id = ${advisorId}`)[0];
  return safeZone(row?.time_zone || "America/Toronto");
}

export async function saveAdvisorZone(advisorId: number, timeZone: string) {
  await ready();
  const zone = safeZone(timeZone);
  await (await getSql())`update advisors set time_zone = ${zone} where id = ${advisorId}`;
  return zone;
}

function zoneHour(date: Date, timeZone: string) {
  const list = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => list.find((part) => part.type === type)?.value || "";
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
}

async function openSlots(advisorId: number, minutes: number, timeZone: string) {
  const calendar = await readCalendars(advisorId).catch(() => null);
  const events = calendar && "events" in calendar && Array.isArray(calendar.events) ? calendar.events : [];
  const busy = events.map((event) => {
    const start = new Date(event.start);
    const end = event.end ? new Date(event.end) : new Date(start.getTime() + 30 * 60_000);
    return { start: start.getTime(), end: end.getTime() };
  }).filter((item) => !Number.isNaN(item.start));
  const found: string[] = [];
  const now = Date.now();
  for (let step = 1; step < 10 * 24 && found.length < 3; step += 1) {
    const start = new Date(now + step * 30 * 60_000);
    start.setUTCMinutes(start.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
    const clock = zoneHour(start, timeZone);
    if (clock.weekday === "Sat" || clock.weekday === "Sun") continue;
    if (clock.hour < 9 || clock.hour > 16 || (clock.hour === 16 && clock.minute > 0)) continue;
    const end = start.getTime() + minutes * 60_000;
    if (busy.some((item) => start.getTime() < item.end && end > item.start)) continue;
    found.push(meetingLabel(start, timeZone));
  }
  return found;
}

export async function findNamedContacts(advisorId: number, name: string) {
  const { noteLookup } = await import("@/lib/lookup-log");
  noteLookup("contacts");
  const needle = name.trim().toLowerCase();
  const rows = await (await getSql())<ContactRow>`
    select id, full_name, email from contacts where advisor_id = ${advisorId} order by full_name limit 5000
  `;
  const strict = rows.filter((row) => {
    const full = row.full_name.toLowerCase();
    if (full === needle || full.includes(needle) || (full.length >= 3 && needle.includes(full))) return true;
    return contactMatchesQuery({ fullName: row.full_name, email: row.email }, needle);
  });
  if (strict.length > 0) return strict;
  const hit = resolveSpokenContact(name, rows.map((row) => ({ id: Number(row.id), name: row.full_name })));
  if (hit.kind !== "one" && hit.kind !== "many") return [];
  const chosen = hit.kind === "one" ? [hit.name] : hit.names;
  return rows.filter((row) => chosen.includes(row.full_name));
}

async function advisorMail(advisorId: number) {
  return (await (await getSql())<{ email: string; advisor_name: string; mail_from: string; mail_name: string; mail_host: string; mail_port: number; mail_pass: string; mail_provider: string; ms_refresh: string }>`
    select email, advisor_name, mail_from, mail_name, mail_host, mail_port, mail_pass, mail_provider, ms_refresh
    from advisors where id = ${advisorId}
  `)[0];
}

async function bookLog(advisorId: number, step: string, detail: string) {
  const line = detail.replace(/\s+/g, " ").slice(0, 500);
  console.info(`[zoom-book] advisor=${advisorId} step=${step} ${line}`);
  try {
    await (await getSql())`insert into zoom_booking_log (advisor_id, step, detail) values (${advisorId}, ${step.slice(0, 40)}, ${line})`;
  } catch {
    /* logging must not hide the booking error */
  }
}

function mailHtml(text: string) {
  const safe = text.replace(/&/g, "&" + "amp;").replace(/</g, "&" + "lt;").replace(/>/g, "&" + "gt;");
  return `<p>${safe.replace(/\n/g, "<br>")}</p>`;
}

async function sendMail(advisorId: number, to: string, subject: string, text: string, extra?: { html?: string; ics?: string }) {
  const address = to.trim();
  if (!address.includes("@")) return { ok: false as const, error: "A confirmation email could not be sent because the address is missing." };
  const row = await advisorMail(advisorId);
  if (!row) return { ok: false as const, error: "The advisor record could not be read, so the confirmation email was not sent." };
  const method = extra?.ics?.includes("METHOD:CANCEL") ? "CANCEL" : "PUBLISH";
  try {
    if (row.mail_provider === "microsoft" || row.ms_refresh) {
      const token = await accessTokenForAdvisor(advisorId);
      await graphSendMail({
        accessToken: token,
        to: address,
        subject,
        html: extra?.html || mailHtml(text),
        files: extra?.ics ? [{ name: "meeting.ics", contentType: `text/calendar; method=${method}`, bytes: Buffer.from(extra.ics, "utf8") }] : [],
      });
      return { ok: true as const };
    }
    if (!row.mail_from || !row.mail_pass || !row.mail_host) {
      return { ok: false as const, error: "Outlook is not connected, so the confirmation email was not sent." };
    }
    const nodemailer = (await import("nodemailer")).default;
    const port = row.mail_port === 465 ? 465 : 587;
    await nodemailer.createTransport({ host: row.mail_host, port, secure: port === 465, auth: { user: row.mail_from, pass: row.mail_pass } }).sendMail({
      from: row.mail_name ? `"${row.mail_name.replace(/"/g, "")}" <${row.mail_from}>` : row.mail_from,
      to: address,
      subject,
      text,
      html: extra?.html,
      icalEvent: extra?.ics ? { filename: "meeting.ics", method, content: extra.ics } : undefined,
    });
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "The confirmation email could not be sent." };
  }
}

export async function mailContact(advisorId: number, to: string, subject: string, text: string) {
  return sendMail(advisorId, to, subject, text);
}

async function notice(advisorId: number, body: string) {
  await ready();
  const sql = await getSql();
  await sql`update desk_notices set seen = true where advisor_id = ${advisorId} and seen = false`;
  await sql`insert into desk_notices (advisor_id, body) values (${advisorId}, ${body.slice(0, 500)})`;
}

type PendingBooking = {
  contact_id: number;
  contact_name: string;
  contact_email: string;
  topic: string;
  start_at: string;
  local_start: string;
  local_end: string;
  time_zone: string;
  label: string;
  minutes: number;
};

async function saveDeskBooking(advisorId: number, row: { title: string; start: string; minutes: number; join: string; zoomId: string; passcode?: string; outlookId?: string; icsToken?: string }, person: { id: number; name: string; email: string }, topic: string) {
  const start = new Date(row.start);
  if (!row.start || Number.isNaN(start.getTime()) || !row.join.startsWith("https://")) {
    throw new Error("The meeting was not saved because it has no date.");
  }
  const sql = await getSql();
  await sql`
    insert into desk_calendar_events (advisor_id, source, title, start_at, minutes)
    values (${advisorId}, ${"Zoom"}, ${row.title}, ${start.toISOString()}, ${row.minutes})
  `;
  await sql`
    insert into zoom_bookings (advisor_id, contact_id, contact_name, contact_email, topic, start_at, minutes, join_url, zoom_id, passcode, outlook_id, ics_token)
    values (${advisorId}, ${person.id}, ${person.name}, ${person.email}, ${topic}, ${row.start}, ${row.minutes}, ${row.join}, ${row.zoomId}, ${row.passcode || ""}, ${row.outlookId || ""}, ${row.icsToken || ""})
  `;
  await writeContactLog(advisorId, person.id, "meeting", `Zoom booked. ${topic}. Join: ${row.join}`);
  const span = formatMeetingSpan(start, row.minutes || 30, await advisorZone(advisorId));
  await notice(advisorId, `Zoom with ${person.name} is booked for ${span}. ${row.join}`);
}

async function rememberPending(advisorId: number, row: PendingBooking) {
  await ready();
  await (await getSql())`
    insert into zoom_pending (advisor_id, contact_id, contact_name, contact_email, topic, start_at, local_start, local_end, time_zone, label, minutes)
    values (${advisorId}, ${row.contact_id}, ${row.contact_name}, ${row.contact_email}, ${row.topic}, ${row.start_at}, ${row.local_start}, ${row.local_end}, ${row.time_zone}, ${row.label}, ${row.minutes})
    on conflict (advisor_id) do update set
      contact_id = excluded.contact_id,
      contact_name = excluded.contact_name,
      contact_email = excluded.contact_email,
      topic = excluded.topic,
      start_at = excluded.start_at,
      local_start = excluded.local_start,
      local_end = excluded.local_end,
      time_zone = excluded.time_zone,
      label = excluded.label,
      minutes = excluded.minutes
  `;
}

async function takePending(advisorId: number) {
  await ready();
  return (await (await getSql())<PendingBooking>`
    delete from zoom_pending where advisor_id = ${advisorId} returning contact_id, contact_name, contact_email, topic, start_at, local_start, local_end, time_zone, label, minutes
  `)[0] || null;
}

type MeetingBrand = {
  name: string;
  title: string;
  phone: string;
  email: string;
  company: string;
  website: string;
  photo: string;
};

async function loadMeetingBrand(advisorId: number): Promise<MeetingBrand> {
  const row = (await (await getSql())<{
    advisor_name: string;
    practice_name: string;
    email: string;
    public_name: string;
    public_title: string;
    public_photo: string;
    public_phone: string;
    public_card_email: string;
    public_company: string;
    public_website: string;
    public_social: string;
    site_mode: string;
    site_url: string;
    slug: string;
  }>`
    select advisor_name, practice_name, email, public_name, public_title, public_photo, public_phone, public_card_email, public_company, public_website, public_social, site_mode, site_url, slug
    from advisors where id = ${advisorId}
  `)[0];
  let photoOn = false;
  try {
    const parsed = JSON.parse(row?.public_social || "{}") as { photoOnEletter?: boolean; photoOnNewsletter?: boolean };
    photoOn = parsed.photoOnEletter === undefined ? Boolean(parsed.photoOnNewsletter) : Boolean(parsed.photoOnEletter);
  } catch {
    photoOn = false;
  }
  const name = (row?.public_name || row?.advisor_name || "Your advisor").trim() || "Your advisor";
  const company = (row?.public_company || row?.practice_name || "").trim();
  const photo = row?.public_photo || "";
  return {
    name,
    title: (row?.public_title || "").trim(),
    phone: (row?.public_phone || "").trim(),
    email: (row?.public_card_email || row?.email || "").trim(),
    company: company.toLowerCase() === name.toLowerCase() ? "" : company,
    website: shownWebsite({ siteMode: row?.site_mode, siteUrl: row?.site_url, publicWebsite: row?.public_website, slug: row?.slug }),
    photo: photoOn && photo.startsWith("data:image/") && photo.length < 180000 ? photo : "",
  };
}

function composeMeetingLetter(
  kind: "confirm" | "reminder" | "cancel",
  audience: "client" | "advisor",
  brand: MeetingBrand,
  detail: { clientName: string; topic: string; whenUtc: string; timeZone: string; minutes: number; join: string; meetingId: string; passcode: string; icsToken: string },
) {
  return buildMeetingLetter({
    kind,
    audience,
    clientName: detail.clientName,
    advisorName: brand.name,
    advisorTitle: brand.title,
    advisorPhone: brand.phone,
    advisorEmail: brand.email,
    advisorCompany: brand.company,
    advisorWebsite: brand.website,
    photoSrc: brand.photo,
    topic: detail.topic,
    whenUtc: detail.whenUtc,
    timeZone: detail.timeZone,
    minutes: detail.minutes,
    join: detail.join,
    meetingId: detail.meetingId,
    passcode: detail.passcode,
    icsToken: detail.icsToken,
    icsUrl: detail.icsToken && kind !== "cancel" ? `https://youradviser.grok.me/api/meetings/ics?token=${encodeURIComponent(detail.icsToken)}` : "",
    design: "plum",
  });
}

async function placePending(advisorId: number, pending: PendingBooking) {
  await bookLog(advisorId, "confirm", `${pending.contact_name} ${pending.label}`);
  const zoomToken = await linkAccessToken(advisorId, "zoom");
  if (!zoomToken) return { ok: false as const, booked: false as const, error: "Zoom is not signed in. Press Sign in with Zoom, then ask again. Not booked." };
  let outlookToken: string | null = null;
  try {
    outlookToken = await accessToken(advisorId, "outlook_calendar");
  } catch {
    outlookToken = null;
  }
  if (!outlookToken) {
    try {
      outlookToken = await accessTokenForAdvisor(advisorId);
    } catch {
      outlookToken = null;
    }
  }
  const advisor = await advisorMail(advisorId);
  const brand = await loadMeetingBrand(advisorId);
  const result = await commitZoomBooking({
    advisorId,
    zoomToken,
    outlookToken,
    topic: pending.topic,
    localStart: pending.local_start,
    localEnd: pending.local_end,
    timeZone: pending.time_zone,
    whenUtc: new Date(pending.start_at).toISOString(),
    minutes: Number(pending.minutes) || 30,
    label: pending.label,
    advisorEmail: advisor?.email || "",
    clientEmail: pending.contact_email,
    clientName: pending.contact_name,
    contactId: Number(pending.contact_id),
    log: (step, detail) => void bookLog(advisorId, step, detail),
    mail: (to, subject, text, extra) => sendMail(advisorId, to, subject, text, extra),
    compose: (audience, detail) => composeMeetingLetter("confirm", audience, brand, {
      clientName: pending.contact_name,
      topic: pending.topic,
      whenUtc: new Date(pending.start_at).toISOString(),
      timeZone: pending.time_zone,
      minutes: Number(pending.minutes) || 30,
      join: detail.join,
      meetingId: detail.meetingId,
      passcode: detail.passcode,
      icsToken: detail.icsToken,
    }),
    saveDesk: (row) => saveDeskBooking(advisorId, row, { id: Number(pending.contact_id), name: pending.contact_name, email: pending.contact_email }, pending.topic),
  });
  if (!result.ok) await bookLog(advisorId, "failed", result.error);
  return result;
}

export async function confirmPendingZoom(advisorId: number) {
  const pending = await takePending(advisorId);
  if (!pending) return null;
  const result = await placePending(advisorId, pending);
  if (!result.ok) await rememberPending(advisorId, pending);
  return { reply: result.ok ? result.message : result.error };
}

export async function clearPendingZoom(advisorId: number) {
  await takePending(advisorId);
}

function spokenLine(lines: string[]) {
  return [...lines].reverse().find((line) => hasMeetingWhen(line)) || "";
}

export async function bookZoom(advisorId: number, args: { contactName?: string; whenText?: string; start?: string; minutes?: number; topic?: string; confirm?: boolean }, history: string[] = [], now = new Date()) {
  await ready();
  const name = String(args.contactName || "").trim();
  if (name.length < 2) return { ok: false as const, error: "Which contact is the meeting with?" };
  const people = await findNamedContacts(advisorId, name);
  if (people.length === 0) return { ok: false as const, error: `No contact matches ${name}. What name is on the contact record?` };
  if (people.length > 1) {
    return { ok: true as const, booked: false, choices: people.slice(0, 6).map((row) => ({ name: row.full_name, email: row.email })), message: "More than one contact matches. Which person should I book?" };
  }
  const person = people[0];
  if (!person?.email.includes("@")) return { ok: false as const, error: `${person?.full_name || "That contact"} has no email address, so the invitation cannot be sent.` };
  const latest = history.at(-1) || "";
  if (/^change(?: the)? time\b/i.test(latest.trim())) {
    await takePending(advisorId);
    return { ok: true as const, booked: false, message: "What day and time should I use instead?" };
  }
  const agreed = isTimeAgreement(latest);
  if (agreed) {
    const pending = await takePending(advisorId);
    if (pending) {
      const placed = await placePending(advisorId, pending);
      if (!placed.ok) await rememberPending(advisorId, pending);
      return placed.ok
        ? { ok: true as const, booked: true as const, contact: pending.contact_name, when: pending.label, topic: pending.topic, join: placed.join, message: placed.message }
        : { ok: false as const, booked: false as const, error: placed.error };
    }
  }
  const zone = await advisorZone(advisorId);
  const minutes = Math.min(180, Math.max(15, Number(args.minutes) || 30));
  const source = (agreed ? spokenLine(history.slice(0, -1)) : spokenLine(history)) || String(args.whenText || args.start || "");
  const resolved = resolveMeetingWhen(source, zone, now);
  if (!resolved.ok) {
    const slots = await openSlots(advisorId, minutes, zone);
    return { ok: true as const, booked: false, contact: person.full_name, slots, message: resolved.error };
  }
  if (resolved.past) {
    return { ok: true as const, booked: false, past: true, label: resolved.label, message: `${resolved.label} has already passed. What day and time should I use instead?` };
  }
  const topic = zoomMeetingTitle(person.full_name, args.topic).slice(0, 120);
  const localEnd = localClock(new Date(resolved.instant.getTime() + minutes * 60_000), zone);
  const pending: PendingBooking = {
    contact_id: Number(person.id),
    contact_name: person.full_name,
    contact_email: person.email,
    topic,
    start_at: resolved.instant.toISOString(),
    local_start: resolved.local,
    local_end: localEnd,
    time_zone: zone,
    label: resolved.label,
    minutes,
  };
  if (!agreed) {
    await rememberPending(advisorId, pending);
    await bookLog(advisorId, "await-confirm", `${person.full_name} ${resolved.label}`);
    return { ok: true as const, booked: false, needsConfirm: true, label: resolved.label, message: confirmAsk(minutes, person.full_name, resolved.label) };
  }
  const placed = await placePending(advisorId, pending);
  return placed.ok
    ? { ok: true as const, booked: true as const, contact: person.full_name, when: resolved.label, topic, join: placed.join, message: placed.message }
    : { ok: false as const, booked: false as const, error: placed.error };
}

export async function fileSettings(advisorId: number) {
  await ready();
  const row = (await (await getSql())<{ save_zoom_recordings: boolean; file_store: string }>`
    select save_zoom_recordings, file_store from advisors where id = ${advisorId}
  `)[0];
  const store = STORES.includes(row?.file_store as Store) ? row?.file_store as Store : "dropbox";
  return { saveRecordings: row ? row.save_zoom_recordings !== false : true, store };
}

export async function saveFileSettings(advisorId: number, input: { saveRecordings?: boolean; store?: string }) {
  await ready();
  const current = await fileSettings(advisorId);
  const store = STORES.includes(input.store as Store) ? input.store as Store : current.store;
  const saveRecordings = typeof input.saveRecordings === "boolean" ? input.saveRecordings : current.saveRecordings;
  await (await getSql())`update advisors set save_zoom_recordings = ${saveRecordings}, file_store = ${store} where id = ${advisorId}`;
  return { saveRecordings, store };
}

function clockLabel(instant: Date, zone: string, minutes: number) {
  const span = formatMeetingSpan(instant, minutes, zone);
  return { when: span, time: span };
}

export async function listUpcomingMeetings(advisorId: number) {
  await ready();
  const sql = await getSql();
  await sql`delete from desk_calendar_events where advisor_id = ${advisorId} and start_at is null`;
  await sql`delete from zoom_bookings where advisor_id = ${advisorId} and (start_at is null or coalesce(join_url, '') = '')`;
  await sql`
    delete from desk_calendar_events d
    where d.advisor_id = ${advisorId} and d.source = 'Zoom'
      and not exists (
        select 1 from zoom_bookings z
        where z.advisor_id = d.advisor_id and z.join_url <> '' and z.start_at = d.start_at
      )
  `;
  const zone = await advisorZone(advisorId);
  const window = deskDayWindow(new Date(), zone);
  const zoom = await sql<{ id: number; contact_name: string; topic: string; start_at: string; minutes: number; join_url: string }>`
    select id, contact_name, topic, start_at, minutes, join_url
    from zoom_bookings
    where advisor_id = ${advisorId} and start_at >= ${window.start.toISOString()} and start_at < ${window.end.toISOString()} and join_url <> ''
    order by start_at
  `;
  const others = await sql<{ id: number; source: string; title: string; start_at: string; minutes: number }>`
    select id, source, title, start_at, minutes
    from desk_calendar_events
    where advisor_id = ${advisorId} and source <> 'Zoom' and start_at >= ${window.start.toISOString()} and start_at < ${window.end.toISOString()}
    order by start_at
  `;
  const now = new Date();
  const zoomTimes = zoom.map((row) => new Date(row.start_at).getTime());
  const meetings = [
    ...zoom.flatMap((row) => {
      const start = new Date(row.start_at);
      if (!onDeskDays(start, now, zone)) return [];
      const clock = clockLabel(start, zone, Number(row.minutes) || 30);
      if (!clock.when || !clock.time) return [];
      return [{ id: `zoom-${row.id}`, when: clock.when, time: clock.time, schedule: clock.when, minutes: Number(row.minutes) || 30, client: row.contact_name || "Client", title: row.topic || "Zoom meeting", join: row.join_url, start: start.toISOString() }];
    }),
    ...others.filter((row) => {
      const at = new Date(row.start_at).getTime();
      return !zoomTimes.some((booked) => Math.abs(booked - at) < 5 * 60_000);
    }).flatMap((row) => {
      const start = new Date(row.start_at);
      if (!onDeskDays(start, now, zone)) return [];
      const clock = clockLabel(start, zone, Number(row.minutes) || 30);
      if (!clock.when || !clock.time) return [];
      return [{ id: `desk-${row.id}`, when: clock.when, time: clock.time, schedule: clock.when, minutes: Number(row.minutes) || 30, client: row.title || "Appointment", title: row.source || "Calendar", join: "", start: start.toISOString() }];
    }),
  ].sort((left, right) => left.start.localeCompare(right.start));
  return { timeZone: zone, meetings };
}

export async function listDeskNotices(advisorId: number) {
  await ready();
  const rows = await (await getSql())<{ id: number; body: string; created_at: string }>`
    select id, body, created_at from desk_notices where advisor_id = ${advisorId} and seen = false order by id desc
  `;
  const latest = rows[0];
  if (!latest) return [];
  if (rows.length > 1) {
    await (await getSql())`update desk_notices set seen = true where advisor_id = ${advisorId} and seen = false and id <> ${Number(latest.id)}`;
  }
  let body = latest.body;
  if (/is booked/i.test(body) && !body.includes("·")) {
    const booking = await (await getSql())<{ start_at: string; minutes: number }>`
      select start_at, minutes from zoom_bookings
      where advisor_id = ${advisorId} and start_at is not null
      order by id desc limit 1
    `;
    const row = booking[0];
    if (row?.start_at) {
      const span = formatMeetingSpan(new Date(row.start_at), Number(row.minutes) || 30, await advisorZone(advisorId));
      if (span) body = `${body.replace(/\s+/g, " ").trim()} ${span}`;
    }
  }
  return [{ id: Number(latest.id), body, at: new Date(latest.created_at).toISOString() }];
}

export async function clearDeskNotices(advisorId: number) {
  await ready();
  await (await getSql())`update desk_notices set seen = true where advisor_id = ${advisorId} and seen = false`;
}

async function dropboxPut(token: string, path: string, bytes: Uint8Array) {
  const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "add", autorename: true, mute: true }),
    },
    body: Buffer.from(bytes),
  });
  return response.ok ? path : "";
}

async function boxFolder(token: string, parent: string, name: string) {
  const response = await fetch("https://api.box.com/2.0/folders", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent: { id: parent } }),
  });
  const json = (await response.json()) as { id?: string; context_info?: { conflicts?: Array<{ id?: string }> } };
  return json.id || json.context_info?.conflicts?.[0]?.id || "";
}

async function boxPut(token: string, folder: string, name: string, bytes: Uint8Array) {
  let parent = "0";
  for (const part of folder.split("/").filter(Boolean)) {
    parent = await boxFolder(token, parent, part);
    if (!parent) return "";
  }
  const form = new FormData();
  form.append("attributes", JSON.stringify({ name, parent: { id: parent } }));
  form.append("file", new Blob([Buffer.from(bytes)]), name);
  const response = await fetch("https://upload.box.com/api/2.0/files/content", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) return "";
  const json = (await response.json()) as { entries?: Array<{ id?: string }> };
  const id = json.entries?.[0]?.id;
  return id ? `https://app.box.com/file/${id}` : folder;
}

async function driveFolder(token: string, parent: string, name: string) {
  const query = [`name = '${name.replace(/'/g, "\\'")}'`, "mimeType = 'application/vnd.google-apps.folder'", "trashed = false"];
  if (parent) query.push(`'${parent}' in parents`);
  const listed = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query.join(" and "))}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const existing = ((await listed.json()) as { files?: Array<{ id?: string }> }).files?.[0]?.id;
  if (existing) return existing;
  const created = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parent ? [parent] : undefined }),
  });
  return ((await created.json()) as { id?: string }).id || "";
}

async function drivePut(token: string, folder: string, name: string, bytes: Uint8Array, mime: string, asDoc = false) {
  let parent = "";
  for (const part of folder.split("/").filter(Boolean)) {
    parent = await driveFolder(token, parent, part);
    if (!parent) return "";
  }
  const meta = { name: asDoc ? name.replace(/\.[a-z0-9]+$/i, "") : name, parents: parent ? [parent] : undefined, mimeType: asDoc ? "application/vnd.google-apps.document" : mime };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  form.append("file", new Blob([Buffer.from(bytes)], { type: asDoc ? "text/plain" : mime }), name);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) return "";
  const json = (await response.json()) as { webViewLink?: string; id?: string };
  return json.webViewLink || (json.id ? `https://drive.google.com/file/d/${json.id}/view` : folder);
}

async function saveFile(advisorId: number, store: Store, folder: string, name: string, bytes: Uint8Array, mime: string, asDoc = false) {
  if (store === "dropbox") {
    const token = await linkAccessToken(advisorId, "dropbox");
    if (!token) return "";
    return dropboxPut(token, `${folder}/${name}`, bytes);
  }
  if (store === "box") {
    const token = await linkAccessToken(advisorId, "box");
    if (!token) return "";
    return boxPut(token, folder, name, bytes);
  }
  const token = await linkAccessToken(advisorId, "google_drive");
  if (!token) return "";
  return drivePut(token, folder, name, bytes, mime, asDoc);
}

async function downloadRecording(token: string, url: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 32 || bytes.byteLength > 200_000_000) return null;
  return bytes;
}

async function sendMeetingNotice(row: { advisor_id: number; contact_name: string; contact_email: string; topic: string; start_at: string; join_url: string; zoom_id: string; minutes: number; passcode: string; ics_token: string; email: string }, zone: string) {
  const brand = await loadMeetingBrand(row.advisor_id);
  const detail = {
    clientName: row.contact_name,
    topic: row.topic,
    whenUtc: new Date(row.start_at).toISOString(),
    timeZone: zone,
    minutes: Number(row.minutes) || 30,
    join: row.join_url,
    meetingId: row.zoom_id,
    passcode: row.passcode || "",
    icsToken: row.ics_token || "",
  };
  for (const audience of ["client", "advisor"] as const) {
    const letter = composeMeetingLetter("reminder", audience, brand, detail);
    const to = audience === "client" ? row.contact_email : row.email;
    await sendMail(row.advisor_id, to, letter.subject, letter.text, { html: letter.html, ics: letter.ics });
  }
}

type ZoomBookingRow = {
  id: number;
  contact_id: number;
  contact_name: string;
  contact_email: string;
  topic: string;
  start_at: string;
  minutes: number;
  join_url: string;
  zoom_id: string;
  passcode: string;
  outlook_id: string;
  ics_token: string;
};

async function deleteZoomMeeting(token: string, zoomId: string) {
  if (!zoomId) return "Zoom meeting id was missing, so the Zoom meeting was not deleted.";
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(zoomId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 204 || response.status === 404) return "";
  const text = await response.text();
  return `Zoom did not delete the meeting: ${text.replace(/\s+/g, " ").slice(0, 180) || response.status}`;
}

async function removeExternalCalendar(advisorId: number, input: { source: string; title: string; start: string; externalId: string; join: string; outlookId: string }) {
  const errors: string[] = [];
  const source = input.source.toLowerCase();
  let outlook = "";
  let google = "";
  try {
    outlook = (await accessToken(advisorId, "outlook_calendar")) || "";
  } catch {
    outlook = "";
  }
  if (!outlook) {
    try {
      outlook = (await accessTokenForAdvisor(advisorId)) || "";
    } catch {
      outlook = "";
    }
  }
  try {
    google = (await accessToken(advisorId, "google")) || "";
  } catch {
    google = "";
  }
  const wantOutlook = source === "outlook" || source === "zoom";
  const wantGoogle = source === "google" || source === "zoom";
  if (source === "outlook" && !outlook) errors.push("Outlook is not connected, so the calendar event was not deleted.");
  if (source === "google" && !google) errors.push("Google Calendar is not connected, so the calendar event was not deleted.");
  if (source === "zoom" && !outlook && !google) errors.push("No calendar is connected, so the calendar event was not deleted.");
  if (wantOutlook && outlook) {
    const removed = await deleteConnectedEvent({
      provider: "outlook",
      token: outlook,
      eventId: input.outlookId || (source === "outlook" ? input.externalId : ""),
      title: input.title,
      start: input.start,
      join: input.join,
    });
    if (!removed.ok) errors.push(removed.error);
  }
  if (wantGoogle && google) {
    const removed = await deleteConnectedEvent({
      provider: "google",
      token: google,
      eventId: source === "google" ? input.externalId : "",
      title: input.title,
      start: input.start,
      join: input.join,
    });
    if (!removed.ok) errors.push(removed.error);
  }
  return errors;
}

export async function cancelBookedMeeting(advisorId: number, input: { meetingId?: string; eventId?: number; notify?: boolean }) {
  await ready();
  const sql = await getSql();
  const meetingId = String(input.meetingId || "");
  let booking: ZoomBookingRow | null = null;
  let deskId = 0;
  if (meetingId.startsWith("zoom-")) {
    const id = Number(meetingId.slice(5));
    booking = (await sql<ZoomBookingRow>`
      select id, contact_id, contact_name, contact_email, topic, start_at, minutes, join_url, zoom_id, passcode, outlook_id, ics_token
      from zoom_bookings where advisor_id = ${advisorId} and id = ${id}
    `)[0] || null;
    if (!booking) return { ok: false as const, error: "That meeting is no longer on the calendar." };
  } else if (meetingId.startsWith("desk-")) {
    deskId = Number(meetingId.slice(5));
  } else if (Number(input.eventId) > 0) {
    deskId = Number(input.eventId);
  } else {
    return { ok: false as const, error: "That meeting is no longer on the calendar." };
  }
  if (!booking) {
    const event = (await sql<{ id: number; source: string; title: string; start_at: string; external_id: string }>`
      select id, source, title, start_at, external_id from desk_calendar_events where advisor_id = ${advisorId} and id = ${deskId}
    `)[0];
    if (!event) return { ok: false as const, error: "That meeting is no longer on the calendar." };
    if (event.source === "Zoom") {
      const at = new Date(event.start_at).getTime();
      const from = new Date(at - 2 * 60 * 1000).toISOString();
      const to = new Date(at + 2 * 60 * 1000).toISOString();
      booking = (await sql<ZoomBookingRow>`
        select id, contact_id, contact_name, contact_email, topic, start_at, minutes, join_url, zoom_id, passcode, outlook_id, ics_token
        from zoom_bookings where advisor_id = ${advisorId} and start_at >= ${from} and start_at <= ${to}
        order by id desc limit 1
      `)[0] || null;
    }
    if (!booking) {
      const problems = await removeExternalCalendar(advisorId, { source: event.source, title: event.title, start: new Date(event.start_at).toISOString(), externalId: event.external_id || "", join: "", outlookId: "" });
      if (problems.length > 0) return { ok: false as const, error: problems.join(" ") };
      await sql`delete from desk_calendar_events where advisor_id = ${advisorId} and id = ${event.id}`;
      return { ok: true as const, warning: "" };
    }
  }
  const warnings: string[] = [];
  const problems: string[] = [];
  const zoomToken = await linkAccessToken(advisorId, "zoom").catch(() => "");
  if (!zoomToken) problems.push("Zoom is not signed in, so the Zoom meeting was not deleted.");
  else {
    const problem = await deleteZoomMeeting(zoomToken, booking.zoom_id);
    if (problem) problems.push(problem);
  }
  problems.push(...await removeExternalCalendar(advisorId, {
    source: "Zoom",
    title: booking.topic || "",
    start: new Date(booking.start_at).toISOString(),
    externalId: "",
    join: booking.join_url,
    outlookId: booking.outlook_id,
  }));
  if (problems.length > 0) return { ok: false as const, error: problems.join(" ") };
  await sql`delete from desk_calendar_events where advisor_id = ${advisorId} and source = 'Zoom' and start_at = ${booking.start_at}`;
  await sql`delete from zoom_bookings where advisor_id = ${advisorId} and id = ${booking.id}`;
  if (input.notify !== false) {
    if (!booking.contact_email.includes("@")) {
      warnings.push("The client has no email address, so the cancellation notice was not sent.");
    } else {
      const zone = await advisorZone(advisorId);
      const brand = await loadMeetingBrand(advisorId);
      const letter = composeMeetingLetter("cancel", "client", brand, {
        clientName: booking.contact_name,
        topic: booking.topic,
        whenUtc: new Date(booking.start_at).toISOString(),
        timeZone: zone,
        minutes: Number(booking.minutes) || 30,
        join: booking.join_url,
        meetingId: booking.zoom_id,
        passcode: booking.passcode || "",
        icsToken: booking.ics_token || "",
      });
      const mailed = await sendMail(advisorId, booking.contact_email, letter.subject, letter.text, { html: letter.html, ics: letter.ics });
      if (!mailed.ok) warnings.push(`The client cancellation email failed: ${mailed.error}`);
    }
  }
  await writeContactLog(advisorId, Number(booking.contact_id), "meeting", `Zoom cancelled. ${booking.topic}.`);
  await notice(advisorId, `Zoom with ${booking.contact_name} was cancelled.`);
  return { ok: true as const, warning: warnings.join(" ") };
}

export async function meetingCalendarFile(token: string) {
  const clean = token.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(clean)) return null;
  await ready();
  const row = (await (await getSql())<{ topic: string; start_at: string; minutes: number; join_url: string; ics_token: string }>`
    select topic, start_at, minutes, join_url, ics_token from zoom_bookings where ics_token = ${clean} limit 1
  `)[0];
  if (!row) return null;
  return meetingIcs({
    uid: `${row.ics_token}@uniqueadvisor`,
    whenUtc: new Date(row.start_at).toISOString(),
    minutes: Number(row.minutes) || 30,
    topic: row.topic || "Meeting",
    join: row.join_url || "",
  });
}

export async function runZoomJobs() {
  try {
    await ready();
    const sql = await getSql();
    const due = await sql<{ id: number; advisor_id: number; contact_id: number; contact_name: string; contact_email: string; topic: string; start_at: string; join_url: string; reminded_day: boolean; reminded_hour: boolean; zoom_id: string; minutes: number; recording_state: string; passcode: string; ics_token: string; email: string; status: string }>`
      select z.id, z.advisor_id, z.contact_id, z.contact_name, z.contact_email, z.topic, z.start_at, z.join_url, z.reminded_day, z.reminded_hour, z.zoom_id, z.minutes, z.recording_state, z.passcode, z.ics_token, a.email, a.status
      from zoom_bookings z
      join advisors a on a.id = z.advisor_id
      where a.status <> 'suspended' and (z.recording_state = 'waiting' or z.reminded_day = false or z.reminded_hour = false)
      order by z.start_at
      limit 20
    `;
    const now = Date.now();
    for (const row of due) {
      const start = new Date(row.start_at).getTime();
      const zone = await advisorZone(row.advisor_id);
      const local = meetingLabel(new Date(row.start_at), zone);
      if (!row.reminded_day && start > now) {
        if (start - now <= 24 * 60 * 60 * 1000 && start - now > 2 * 60 * 60 * 1000) {
          await sendMeetingNotice(row, zone).catch(() => undefined);
          await notice(row.advisor_id, `Zoom with ${row.contact_name} is in 24 hours. ${local}.`);
        }
        if (start - now <= 24 * 60 * 60 * 1000) await sql`update zoom_bookings set reminded_day = true where id = ${row.id}`;
      }
      if (!row.reminded_hour && start - now <= 60 * 60 * 1000 && start > now) {
        await sendMeetingNotice(row, zone).catch(() => undefined);
        await notice(row.advisor_id, `Zoom with ${row.contact_name} is in 1 hour. ${local}.`);
        await sql`update zoom_bookings set reminded_hour = true where id = ${row.id}`;
      }
      const ended = start + (Number(row.minutes) || 30) * 60_000;
      if (row.recording_state !== "waiting" || !row.zoom_id) continue;
      if (ended > now) continue;
      if (now - ended > 3 * 24 * 60 * 60 * 1000) {
        await sql`update zoom_bookings set recording_state = 'failed' where id = ${row.id}`;
        continue;
      }
      const settings = await fileSettings(row.advisor_id);
      if (!settings.saveRecordings) {
        await sql`update zoom_bookings set recording_state = 'skipped' where id = ${row.id}`;
        continue;
      }
      const token = await linkAccessToken(row.advisor_id, "zoom");
      if (!token) continue;
      const recording = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(row.zoom_id)}/recordings`, { headers: { Authorization: `Bearer ${token}` } });
      if (recording.status === 404 || recording.status === 400) continue;
      if (!recording.ok) continue;
      const body = (await recording.json()) as { recording_files?: Array<{ file_type?: string; file_extension?: string; download_url?: string; recording_type?: string; status?: string }> };
      const files = (body.recording_files || []).filter((file) => file.download_url && file.status !== "processing");
      if (files.length === 0) continue;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.start_at));
      const folder = `/Unique Advisor/Clients/${safeName(row.contact_name)}/Meetings/${day} ${safeName(row.topic)}`;
      const links: string[] = [];
      for (const file of files) {
        const kind = `${file.recording_type || ""} ${file.file_type || ""}`.toLowerCase();
        const video = kind.includes("mp4") || kind.includes("shared_screen") || kind.includes("video");
        const audio = kind.includes("m4a") || kind.includes("audio");
        const transcript = kind.includes("transcript") || kind.includes("vtt") || kind.includes("txt");
        if (!video && !audio && !transcript) continue;
        const bytes = await downloadRecording(token, file.download_url || "");
        if (!bytes) continue;
        const ext = (file.file_extension || (video ? "mp4" : audio ? "m4a" : "vtt")).toLowerCase();
        const label = video ? "video" : audio ? "audio" : "transcript";
        const link = await saveFile(row.advisor_id, settings.store, folder, `${label}.${ext}`, bytes, video ? "video/mp4" : audio ? "audio/mp4" : "text/plain", transcript && settings.store === "google_drive");
        if (link) links.push(link);
      }
      if (links.length === 0) continue;
      await sql`update zoom_bookings set recording_state = 'saved' where id = ${row.id}`;
      await writeContactLog(row.advisor_id, Number(row.contact_id), "meeting", `Zoom recording saved. ${folder}. ${links[0]}`);
      await notice(row.advisor_id, `The Zoom recording for ${row.contact_name} is in ${folder}.`);
    }
  } catch {
    /* the next check tries again */
  }
}

const zoomClock = globalThis as { uaZoomClock?: ReturnType<typeof setInterval> };
if (typeof window === "undefined" && !zoomClock.uaZoomClock) {
  zoomClock.uaZoomClock = setInterval(() => {
    void runZoomJobs();
  }, 5 * 60 * 1000);
}
