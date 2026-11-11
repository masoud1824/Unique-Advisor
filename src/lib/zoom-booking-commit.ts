import { zoomMeetingTitle } from "./meeting-time.ts";
import { chatJoinLink } from "./assistant-reply.ts";

function newToken() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return id.replace(/-/g, "").toLowerCase().slice(0, 32).padEnd(32, "0");
}

export function meetingReply(result: { booked?: boolean; message?: string; error?: string; join?: string }) {
  if (result.booked && result.join) return result.message || `Booked. ${chatJoinLink(result.join)}`;
  if (result.message && !result.error) return result.message;
  const error = (result.error || "No Zoom meeting, Outlook event, or confirmation email was created.").replace(/\s*Not booked\.?$/i, "").trim();
  return /^not booked\b/i.test(error) ? error : `Not booked. ${error}`;
}

export async function commitZoomBooking(input: {
  advisorId: number;
  zoomToken: string;
  outlookToken: string | null;
  topic: string;
  localStart: string;
  localEnd: string;
  timeZone: string;
  whenUtc: string;
  minutes: number;
  label: string;
  advisorEmail: string;
  clientEmail: string;
  clientName: string;
  contactId: number;
  fetchImpl?: typeof fetch;
  log?: (step: string, detail: string) => void;
  mail: (to: string, subject: string, text: string, extra?: { html?: string; ics?: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  compose?: (audience: "client" | "advisor", detail: { join: string; meetingId: string; passcode: string; icsUrl: string; icsToken: string }) => { subject: string; text: string; html: string; ics: string };
  saveDesk?: (row: { title: string; start: string; minutes: number; join: string; zoomId: string; passcode?: string; outlookId?: string; icsToken?: string }) => Promise<void>;
}) {
  const call = input.fetchImpl || fetch;
  const log = (step: string, detail: string) => input.log?.(step, detail);
  const title = zoomMeetingTitle(input.clientName, input.topic);
  const zoomBody = { topic: title, type: 2, start_time: input.localStart, duration: input.minutes, timezone: input.timeZone };
  log("zoom-request", JSON.stringify(zoomBody));
  let response = await call("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.zoomToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...zoomBody, settings: { auto_recording: "cloud" } }),
  });
  if (!response.ok) {
    const first = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
    log("zoom-retry", first || String(response.status));
    response = await call("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.zoomToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(zoomBody),
    });
  }
  const zoomText = await response.text();
  log("zoom-result", `${response.status} ${zoomText.replace(/\s+/g, " ").slice(0, 300)}`);
  if (!response.ok) {
    return { ok: false as const, booked: false as const, error: `Zoom did not create the meeting: ${zoomText.replace(/\s+/g, " ").slice(0, 300) || response.status}. Not booked.` };
  }
  let meeting: { id?: number | string; join_url?: string; password?: string } = {};
  try {
    meeting = JSON.parse(zoomText) as { id?: number | string; join_url?: string; password?: string };
  } catch {
    return { ok: false as const, booked: false as const, error: "Zoom did not return a meeting. Not booked." };
  }
  const join = meeting.join_url || "";
  const zoomId = String(meeting.id || "");
  const passcode = String(meeting.password || "");
  if (!join) return { ok: false as const, booked: false as const, error: "Zoom created no join link, so the meeting was not confirmed. Not booked." };
  if (!input.outlookToken) {
    log("outlook-result", "no Outlook token");
    return { ok: false as const, booked: false as const, error: `Zoom was created (${join}) but Outlook is not connected, so it was not added to the calendar. Not booked.` };
  }
  const outlookBody = {
    subject: title,
    body: { contentType: "Text", content: `${title}\n${input.label}\nJoin Zoom: ${join}` },
    location: { displayName: join },
    start: { dateTime: input.localStart, timeZone: input.timeZone },
    end: { dateTime: input.localEnd, timeZone: input.timeZone },
  };
  log("outlook-request", JSON.stringify(outlookBody.start));
  const outlook = await call("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.outlookToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(outlookBody),
  });
  const outlookText = await outlook.text();
  log("outlook-result", `${outlook.status} ${outlookText.replace(/\s+/g, " ").slice(0, 300)}`);
  if (!outlook.ok) {
    return { ok: false as const, booked: false as const, error: `Outlook did not add the event: ${outlookText.replace(/\s+/g, " ").slice(0, 300) || outlook.status}. Zoom join: ${join}. Not booked.` };
  }
  let outlookId = "";
  try {
    outlookId = String((JSON.parse(outlookText) as { id?: string }).id || "");
  } catch {
    outlookId = "";
  }
  const icsToken = newToken();
  const icsUrl = `https://youradviser.grok.me/api/meetings/ics?token=${encodeURIComponent(icsToken)}`;
  try {
    if (input.saveDesk) await input.saveDesk({ title, start: input.whenUtc, minutes: input.minutes, join, zoomId, passcode, outlookId, icsToken });
    log("desk-save", title);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The desk calendar could not be saved.";
    log("desk-save", message);
    return { ok: false as const, booked: false as const, error: `${message} Zoom join: ${join}. Not booked.` };
  }
  const send = async (audience: "client" | "advisor", email: string) => {
    if (!input.compose) {
      const letter = `Zoom meeting confirmed.\n\n${input.topic}\n${input.label}\n${input.minutes} minutes\n\nJoin: ${join}`;
      return input.mail(email, `Zoom meeting: ${input.topic}`, letter);
    }
    let letter: { subject: string; text: string; html: string; ics: string };
    try {
      letter = input.compose(audience, { join, meetingId: zoomId, passcode, icsUrl, icsToken });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The confirmation email could not be prepared.";
      return { ok: false as const, error: message };
    }
    return input.mail(email, letter.subject, letter.text, { html: letter.html, ics: letter.ics });
  };
  const clientMail = await send("client", input.clientEmail);
  log("email-client", clientMail.ok ? input.clientEmail : clientMail.error);
  if (!clientMail.ok) return { ok: false as const, booked: false as const, error: `The client confirmation email failed: ${clientMail.error} Zoom join: ${join}. Not booked.` };
  const advisorMailResult = await send("advisor", input.advisorEmail);
  log("email-advisor", advisorMailResult.ok ? input.advisorEmail : advisorMailResult.error);
  if (!advisorMailResult.ok) return { ok: false as const, booked: false as const, error: `The advisor confirmation email failed: ${advisorMailResult.error} Zoom join: ${join}. Not booked.` };
  const message = `Booked for ${input.label}. ${chatJoinLink(join)} It is on the Outlook calendar. Confirmation emails were sent to ${input.clientName} and to you. Reminders go to both of you 24 hours and 1 hour before.`;
  log("booked", message);
  return { ok: true as const, booked: true as const, join, zoomId, message };
}
