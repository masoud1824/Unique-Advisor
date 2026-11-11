import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assistantClock, confirmAsk, formatMeetingSpan, resolveMeetingWhen, tidyMeetingTitle, zoomMeetingTitle } from "./meeting-time.ts";

const fridayEvening = new Date("2026-11-06T22:30:00Z");

describe("meeting clock", () => {
  it("resolves tomorrow at 3 on Friday Nov 6 at 5:30 PM Toronto to Saturday Nov 7 at 3:00 PM", () => {
    const hit = resolveMeetingWhen("tomorrow at 3", "America/Toronto", fridayEvening);
    assert.equal(hit.ok, true);
    if (!hit.ok) return;
    assert.equal(hit.label, "Saturday, Nov 7 at 3:00 PM Toronto time");
    assert.equal(hit.local, "2026-11-07T15:00:00");
    assert.equal(hit.past, false);
    assert.equal(hit.instant.toISOString(), "2026-11-07T20:00:00.000Z");
  });

  it("puts that same clock into the assistant request", () => {
    const clock = assistantClock(fridayEvening, "America/Toronto");
    assert.match(clock, /Friday, November 6, 2026 at 5:30 PM/);
    assert.match(clock, /America\/Toronto/);
    assert.match(clock, /Tomorrow at 3:00 PM is Saturday, Nov 7 at 3:00 PM Toronto time/);
  });

  it("asks the advisor to confirm in plain language and does not repeat a name in the title", () => {
    assert.equal(
      confirmAsk(60, "Max Santiago", "Saturday, Nov 7 at 3:00 PM Toronto time"),
      "Just to confirm: a 60-minute Zoom meeting with Max Santiago on Saturday, Nov 7 at 3:00 PM Toronto time. Shall I book it?",
    );
    assert.equal(tidyMeetingTitle("Meeting with Max Santiago with Max Santiago"), "Zoom meeting with Max Santiago");
    assert.equal(tidyMeetingTitle("Annual review"), "Annual review");
    assert.equal(zoomMeetingTitle("Max Santiago", "Meeting with Max Santiago"), "Zoom meeting with Max Santiago");
    assert.equal(zoomMeetingTitle("Max Santiago", ""), "Zoom meeting with Max Santiago");
    assert.equal(zoomMeetingTitle("Max Santiago", "Annual review"), "Annual review");
  });

  it("shows the day, date, and start-to-end time in the advisor time zone", () => {
    assert.equal(formatMeetingSpan(new Date("2026-11-09T19:00:00.000Z"), 30, "America/Toronto"), "Mon, Nov 9 \u00b7 2:00\u20132:30 PM");
    assert.equal(formatMeetingSpan(new Date("invalid"), 30, "America/Toronto"), "");
  });
});
