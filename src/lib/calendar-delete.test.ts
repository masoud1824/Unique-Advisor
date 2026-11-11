import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deleteConnectedEvent, pickCalendarEvent } from "./calendar-delete.ts";

function jsonResponse(status: number, body: unknown) {
  if (status === 204) return new Response(null, { status });
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("calendar delete", () => {
  it("deletes an Outlook event by id and reports the Outlook error", async () => {
    const calls: string[] = [];
    const removed = await deleteConnectedEvent({
      provider: "outlook",
      token: "outlook-token",
      eventId: "evt-1",
      title: "Annual review",
      start: "2026-11-07T20:00:00.000Z",
      fetchImpl: async (url, init) => {
        calls.push(`${init?.method || "GET"} ${url}`);
        return jsonResponse(204, "");
      },
    });
    assert.equal(removed.ok, true);
    assert.equal(calls[0], "DELETE https://graph.microsoft.com/v1.0/me/events/evt-1");
    const failed = await deleteConnectedEvent({
      provider: "outlook",
      token: "outlook-token",
      eventId: "evt-1",
      title: "Annual review",
      start: "2026-11-07T20:00:00.000Z",
      fetchImpl: async () => jsonResponse(403, "ErrorAccessDenied"),
    });
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.match(failed.error, /Outlook did not delete the event: ErrorAccessDenied/);
  });

  it("finds a Google event and deletes that event", async () => {
    const calls: string[] = [];
    const removed = await deleteConnectedEvent({
      provider: "google",
      token: "google-token",
      title: "Zoom meeting with Max Santiago",
      start: "2026-11-07T20:00:00.000Z",
      join: "https://zoom.us/j/99",
      fetchImpl: async (url, init) => {
        calls.push(`${init?.method || "GET"} ${url}`);
        if ((init?.method || "GET") === "GET") {
          return jsonResponse(200, { items: [{ id: "g-99", summary: "Something else", start: { dateTime: "2026-11-07T20:00:00.000Z" }, location: "https://zoom.us/j/99", description: "" }] });
        }
        return jsonResponse(204, "");
      },
    });
    assert.equal(removed.ok, true);
    assert.match(calls[0], /googleapis.com\/calendar\/v3\/calendars\/primary\/events\?/);
    assert.equal(calls[1], "DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/g-99");
    const failed = await deleteConnectedEvent({
      provider: "google",
      token: "google-token",
      eventId: "g-99",
      title: "Annual review",
      start: "2026-11-07T20:00:00.000Z",
      fetchImpl: async () => jsonResponse(401, "Invalid credentials"),
    });
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.match(failed.error, /Google Calendar did not delete the event: Invalid credentials/);
  });

  it("picks the calendar event with the same title when there is only one", () => {
    assert.equal(pickCalendarEvent([
      { id: "a", title: "Annual review", start: "2026-11-07T18:00:00.000Z", body: "" },
      { id: "b", title: "Other", start: "2026-11-07T20:00:00.000Z", body: "" },
    ], { title: "Annual review", start: "2026-11-07T20:00:00.000Z" }), "a");
  });
});
