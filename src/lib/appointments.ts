import { getRequest } from "@tanstack/react-start/server";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { createCalendarEvent, readCalendars } from "@/lib/advisor-links";
import { getSql } from "@/lib/db";
import { writeContactLog } from "@/lib/contact-records";
import { localClock, meetingLabel, safeZone } from "@/lib/meeting-time";
import { advisorZone, bookZoom, mailContact } from "@/lib/zoom-bookings";

export type OpenSlot = { start: string; label: string };

type LinkRow = {
  token: string;
  advisor_id: number;
  slug: string;
  advisor_name: string;
  contact_id: number;
  contact_name: string;
  contact_email: string;
  topic: string;
  mode: string;
  start_at: string;
  booked_at: string | null;
};

export function bookingHref(token: string) {
  const path = `/api/book/${token}`;
  const published = `https://youradviser.grok.me${path}`;
  try {
    const request = getRequest();
    const referer = request?.headers.get("referer") || "";
    if (!referer) return published;
    const url = new URL(referer);
    const prefix = previewPathPrefix(url.hostname, url.pathname) || "";
    if (prefix || url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "youradviser.grok.me" || url.hostname.endsWith(".grok.me")) {
      return `${url.origin}${prefix}${path}`;
    }
  } catch {
    /* use the published booking page */
  }
  return published;
}

export function appointmentUrl(token: string) {
  return bookingHref(token);
}

async function ready() {
  const sql = await getSql();
  await sql.query(`create table if not exists appointment_links (
    token text primary key,
    advisor_id integer not null,
    contact_id integer not null,
    contact_name text not null default '',
    contact_email text not null default '',
    topic text not null default '',
    mode text not null default '',
    start_at text not null default '',
    booked_at timestamptz
  )`);
}

function zoneHour(date: Date, timeZone: string) {
  const list = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => list.find((part) => part.type === type)?.value || "";
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
}

export async function openAppointmentSlots(advisorId: number): Promise<OpenSlot[]> {
  const zone = safeZone(await advisorZone(advisorId));
  const calendar = await readCalendars(advisorId).catch(() => null);
  const events = calendar && "events" in calendar && Array.isArray(calendar.events) ? calendar.events : [];
  const busy = events
    .map((event) => {
      const start = new Date(event.start);
      const end = event.end ? new Date(event.end) : new Date(start.getTime() + 30 * 60_000);
      return { start: start.getTime(), end: end.getTime() };
    })
    .filter((item) => !Number.isNaN(item.start));
  const found: OpenSlot[] = [];
  const now = Date.now();
  for (let step = 1; step < 14 * 24 * 2 && found.length < 12; step += 1) {
    const start = new Date(now + step * 30 * 60_000);
    start.setUTCMinutes(start.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
    const clock = zoneHour(start, zone);
    if (clock.weekday === "Sat" || clock.weekday === "Sun") continue;
    if (![9, 10, 11, 13, 14, 15].includes(clock.hour) || clock.minute !== 0) continue;
    const end = start.getTime() + 30 * 60_000;
    if (busy.some((item) => start.getTime() < item.end && end > item.start)) continue;
    found.push({ start: start.toISOString(), label: meetingLabel(start, zone) });
  }
  return found;
}

export async function createAppointmentLink(input: { advisorId: number; contactId: number; name: string; email: string; topic: string }) {
  await ready();
  const token = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, "").slice(0, 32);
  await (await getSql())`
    insert into appointment_links (token, advisor_id, contact_id, contact_name, contact_email, topic)
    values (${token}, ${input.advisorId}, ${input.contactId}, ${input.name.slice(0, 120)}, ${input.email.slice(0, 160)}, ${input.topic.slice(0, 160)})
  `;
  return { token, url: appointmentUrl(token) };
}

async function loadLink(token: string) {
  await ready();
  const clean = token.replace(/[^a-f0-9]/gi, "").slice(0, 40);
  if (clean.length < 16) return null;
  const row = (await (await getSql())<LinkRow>`
    select l.token, l.advisor_id, a.slug, a.advisor_name, l.contact_id, l.contact_name, l.contact_email, l.topic, l.mode, l.start_at, l.booked_at
    from appointment_links l
    join advisors a on a.id = l.advisor_id
    where l.token = ${clean}
    limit 1
  `)[0];
  return row || null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

function page(title: string, body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f4efe6;color:#1c1915;font-family:Georgia,serif"><main style="max-width:560px;margin:0 auto;padding:28px 18px 48px"><h1 style="font-size:28px;line-height:1.2;margin:0 0 8px">${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

export async function appointmentPage(token: string) {
  const link = await loadLink(token);
  if (!link) return new Response("This booking link is not valid.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (link.booked_at) {
    const when = link.start_at ? meetingLabel(new Date(link.start_at), await advisorZone(link.advisor_id)) : "the time you chose";
    const where = link.mode === "zoom" ? "by Zoom" : "in person";
    const html = page("You are booked", `<p style="font-size:18px;line-height:1.5">Your meeting with ${escapeHtml(link.advisor_name)} is ${escapeHtml(where)} on ${escapeHtml(when)}.</p>`);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const slots = await openAppointmentSlots(link.advisor_id);
  const advisor = escapeHtml(link.advisor_name || "your advisor");
  const intro = `<p style="font-size:17px;line-height:1.5">Choose a time with ${advisor}. Each time is still open. Pick Zoom or in person.</p>`;
  if (slots.length === 0) {
    const html = page("Book a meeting", `${intro}<p>There is no open time in the next two weeks. Please reply to the letter and ask for another day.</p>`);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const rows = slots
    .map((slot) => `<form method="post" style="margin:0 0 14px;padding:12px 0;border-top:1px solid #ddd4c6"><div style="font-size:17px;margin-bottom:8px">${escapeHtml(slot.label)}</div><input type="hidden" name="start" value="${escapeHtml(slot.start)}"><button name="mode" value="zoom" style="margin-right:8px;padding:10px 14px;font-size:16px">Zoom</button><button name="mode" value="office" style="padding:10px 14px;font-size:16px">In person</button></form>`)
    .join("");
  return new Response(page("Book a meeting", `${intro}${rows}`), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function bookAppointmentChoice(token: string, start: string, mode: string) {
  const link = await loadLink(token);
  if (!link) return new Response("This booking link is not valid.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (link.booked_at) return appointmentPage(token);
  const slots = await openAppointmentSlots(link.advisor_id);
  const slot = slots.find((item) => item.start === start);
  if (!slot || (mode !== "zoom" && mode !== "office")) {
    const html = page("That time is no longer open", `<p>Please choose another time.</p><p><a href="?">Back to the open times</a></p>`);
    return new Response(html, { status: 409, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const topic = link.topic || "Meeting";
  if (mode === "zoom") {
    const zone = await advisorZone(link.advisor_id);
    const whenText = localClock(new Date(slot.start), safeZone(zone));
    const booked = await bookZoom(link.advisor_id, { contactName: link.contact_name, whenText, minutes: 30, topic }, ["yes"]);
    if (!booked.ok || !("booked" in booked) || !booked.booked) {
      const reason = "error" in booked ? booked.error : "message" in booked ? booked.message : "Zoom could not book that time.";
      const html = page("Zoom was not booked", `<p>${escapeHtml(String(reason || "Zoom could not book that time."))}</p><p>You can choose In person, or try another time.</p><p><a href="?">Back to the open times</a></p>`);
      return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  } else {
    const zone = safeZone(await advisorZone(link.advisor_id));
    const local = localClock(new Date(slot.start), zone);
    const end = localClock(new Date(new Date(slot.start).getTime() + 30 * 60_000), zone);
    const title = `In-person meeting with ${link.contact_name}`;
    await createCalendarEvent(link.advisor_id, {
      provider: "outlook_calendar",
      title,
      start: slot.start,
      minutes: 30,
      details: topic,
      location: "In person",
      timeZone: zone,
      localStart: local,
      localEnd: end,
    }).catch(() => null);
    await (await getSql())`
      insert into desk_calendar_events (advisor_id, source, title, start_at, minutes)
      values (${link.advisor_id}, ${"In person"}, ${title}, ${slot.start}, ${30})
    `;
    await writeContactLog(link.advisor_id, link.contact_id, "meeting", `In person booked. ${topic}. ${slot.label}`);
    await mailContact(link.advisor_id, link.contact_email, `Meeting with ${link.advisor_name}`, `Your in-person meeting is booked for ${slot.label}.`).catch(() => null);
  }
  await (await getSql())`
    update appointment_links set mode = ${mode}, start_at = ${slot.start}, booked_at = now() where token = ${link.token}
  `;
  return appointmentPage(token);
}
