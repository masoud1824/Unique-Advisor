import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commitZoomBooking, meetingReply } from "./zoom-booking-commit.ts";
import { buildMeetingLetter } from "./meeting-letter.ts";
import { isTimeAgreement } from "./meeting-time.ts";

const base = {
  advisorId: 7,
  zoomToken: "zoom-token",
  outlookToken: "outlook-token",
  topic: "Meeting with Max Santiago",
  localStart: "2026-11-07T15:00:00",
  localEnd: "2026-11-07T15:30:00",
  timeZone: "America/Toronto",
  whenUtc: "2026-11-07T20:00:00.000Z",
  minutes: 30,
  label: "Saturday, Nov 7 at 3:00 PM Toronto time",
  advisorEmail: "advisor@example.com",
  clientEmail: "max@example.com",
  clientName: "Max Santiago",
  contactId: 4,
};

function jsonResponse(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("zoom booking commit", () => {
  it("creates Zoom, Outlook, the desk entry, and both confirmation emails", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const saved: Array<{ title: string; join: string }> = [];
    const mailed: string[] = [];
    const result = await commitZoomBooking({
      ...base,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body || "") });
        if (String(url).includes("api.zoom.us")) return jsonResponse(201, { id: 99, join_url: "https://zoom.us/j/99" });
        if (String(url).includes("graph.microsoft.com")) return jsonResponse(201, { id: "evt" });
        return jsonResponse(404, "missing");
      },
      mail: async (to) => {
        mailed.push(to);
        return { ok: true as const };
      },
      saveDesk: async (row) => {
        saved.push({ title: row.title, join: row.join });
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.booked, true);
    assert.equal(result.join, "https://zoom.us/j/99");
    assert.match(result.message, /Booked for Saturday, Nov 7 at 3:00 PM Toronto time/);
    const zoom = JSON.parse(calls[0].body) as { topic: string; start_time: string; timezone: string };
    assert.equal(zoom.topic, "Zoom meeting with Max Santiago");
    assert.equal(zoom.start_time, "2026-11-07T15:00:00");
    assert.equal(zoom.timezone, "America/Toronto");
    const outlook = JSON.parse(calls[1].body) as { subject: string; location: { displayName: string }; start: { dateTime: string; timeZone: string } };
    assert.equal(outlook.subject, "Zoom meeting with Max Santiago");
    assert.equal(outlook.location.displayName, "https://zoom.us/j/99");
    assert.equal(outlook.start.dateTime, "2026-11-07T15:00:00");
    assert.equal(outlook.start.timeZone, "America/Toronto");
    assert.equal(saved[0].join, "https://zoom.us/j/99");
    assert.equal(saved[0].title, "Zoom meeting with Max Santiago");
    assert.equal("attendees" in outlook, false);
    assert.deepEqual(mailed, ["max@example.com", "advisor@example.com"]);
  });

  it("does not say booked when Zoom refuses", async () => {
    let saved = false;
    const result = await commitZoomBooking({
      ...base,
      fetchImpl: async () => jsonResponse(400, "Invalid token"),
      mail: async () => ({ ok: true as const }),
      saveDesk: async () => {
        saved = true;
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.booked, false);
    assert.match(result.error, /Not booked/);
    assert.match(result.error, /Invalid token/);
    assert.equal(saved, false);
    assert.match(meetingReply(result), /^Not booked/);
  });

  it("does not say booked when Outlook or email fails", async () => {
    const outlookFail = await commitZoomBooking({
      ...base,
      fetchImpl: async (url) => String(url).includes("zoom") ? jsonResponse(201, { id: 5, join_url: "https://zoom.us/j/5" }) : jsonResponse(403, "ErrorAccessDenied"),
      mail: async () => ({ ok: true as const }),
      saveDesk: async () => undefined,
    });
    assert.equal(outlookFail.ok, false);
    if (!outlookFail.ok) assert.match(outlookFail.error, /Outlook did not add the event/);
    const emailFail = await commitZoomBooking({
      ...base,
      fetchImpl: async (url) => String(url).includes("zoom") ? jsonResponse(201, { id: 6, join_url: "https://zoom.us/j/6" }) : jsonResponse(201, {}),
      mail: async () => ({ ok: false as const, error: "Mailbox full" }),
      saveDesk: async () => undefined,
    });
    assert.equal(emailFail.ok, false);
    if (!emailFail.ok) assert.match(emailFail.error, /confirmation email failed: Mailbox full/);
  });

  it("treats yes and confirm as the signal to book", () => {
    assert.equal(isTimeAgreement("Yes"), true);
    assert.equal(isTimeAgreement("confirm"), true);
    assert.equal(isTimeAgreement("Change time"), false);
    assert.equal(isTimeAgreement("book a Zoom meeting tomorrow at 3"), false);
  });

  it("sends the branded letter and stores the passcode, Outlook id, and calendar token", async () => {
    const mailed: Array<{ to: string; subject: string; text: string; html: string }> = [];
    const saved: { passcode?: string; outlookId?: string; icsToken?: string; join: string } = { join: "" };
    const result = await commitZoomBooking({
      ...base,
      clientName: "Lina Chen",
      fetchImpl: async (url) => jsonResponse(201, String(url).includes("zoom") ? { id: 99, join_url: "https://zoom.us/j/99?pwd=ab&uname=a", password: "246810" } : { id: "evt-1" }),
      compose: (audience, detail) => buildMeetingLetter({
        kind: "confirm",
        audience,
        clientName: "Lina Chen",
        advisorName: "Masoud Zangeneh",
        advisorCompany: "Unique Advisor",
        topic: base.topic,
        whenUtc: base.whenUtc,
        timeZone: base.timeZone,
        minutes: base.minutes,
        join: detail.join,
        meetingId: detail.meetingId,
        passcode: detail.passcode,
        icsUrl: detail.icsUrl,
        icsToken: detail.icsToken,
      }),
      mail: async (to, subject, text, extra) => {
        mailed.push({ to, subject, text, html: extra?.html || "" });
        return { ok: true as const };
      },
      saveDesk: async (row) => {
        saved.passcode = row.passcode;
        saved.outlookId = row.outlookId;
        saved.icsToken = row.icsToken;
        saved.join = row.join;
      },
    });
    assert.equal(result.ok, true);
    assert.equal(mailed.map((item) => item.to).join(","), "max@example.com,advisor@example.com");
    assert.match(mailed[0].subject, /Zoom meeting with Masoud Zangeneh – Sat, Nov 7, 3:00 PM/);
    assert.match(mailed[1].subject, /Zoom meeting with Lina Chen – Sat, Nov 7, 3:00 PM/);
    assert.doesNotMatch(mailed[0].subject, /Meeting confirmed/);
    assert.match(mailed[0].html, /Dear Lina Chen/);
    assert.match(mailed[0].html, /Join Zoom Meeting/);
    assert.match(mailed[0].html, /click here to join/);
    assert.match(mailed[1].html, /Dear Masoud Zangeneh/);
    assert.match(mailed[1].html, /Lina Chen/);
    assert.doesNotMatch(mailed[0].text, /zoom\.us/);
    assert.doesNotMatch(mailed[0].html.replace(/<[^>]+>/g, " "), /zoom\.us/);
    assert.equal(saved.passcode, "246810");
    assert.equal(saved.outlookId, "evt-1");
    assert.match(saved.icsToken || "", /^[a-f0-9]{32}$/);
  });
});
