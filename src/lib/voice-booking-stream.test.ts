import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commitZoomBooking, meetingReply } from "./zoom-booking-commit.ts";
import { assistantPieces, spokenReply } from "./assistant-reply.ts";
import { readCompletionMessage } from "./voice-stream.ts";

const sse = [
  'data: {"choices":[{"delta":{"content":"Booking now."}}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"book_zoom","arguments":""}}]}}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"contactName\\":\\"Max Santiago\\",\\"whenText\\":\\"tomorrow at 3\\",\\"confirm\\":true}"}}]}}]}',
  "data: [DONE]",
  "",
].join("\n");

describe("streaming booking path", () => {
  it("reads the booking tool from the stream and replies only after Zoom, Outlook, and email succeed", async () => {
    const order: string[] = [];
    const response = new Response(sse, { headers: { "content-type": "text/event-stream" } });
    const message = await readCompletionMessage(response, (text) => order.push(`early:${text}`));
    const call = message?.tool_calls?.[0];
    assert.equal(call?.function?.name, "book_zoom");
    const args = JSON.parse(call?.function?.arguments || "{}") as { contactName: string; confirm: boolean };
    assert.equal(args.contactName, "Max Santiago");
    assert.equal(args.confirm, true);
    assert.equal(order.length, 0);
    order.push("tool");
    let saved = false;
    const booked = await commitZoomBooking({
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
      fetchImpl: async (url) => new Response(JSON.stringify(String(url).includes("zoom") ? { id: 99, join_url: "https://zoom.us/j/99" } : { id: "evt" }), { status: 201 }),
      mail: async () => ({ ok: true as const }),
      saveDesk: async (row) => {
        saved = true;
        if (!row.start || Number.isNaN(new Date(row.start).getTime())) throw new Error("The meeting was not saved because it has no date.");
      },
    });
    const reply = meetingReply(booked);
    order.push(reply);
    assert.equal(order[0], "tool");
    assert.match(order[1], /^Booked for Saturday, Nov 7 at 3:00 PM Toronto time/);
    assert.match(order[1], /\[Join Zoom meeting\]\(https:\/\/zoom\.us\/j\/99\)/);
    assert.doesNotMatch(order[1], /Zoom join link:/);
    const said = spokenReply(order[1]);
    assert.match(said, /the Zoom link is in the chat/);
    assert.doesNotMatch(said, /https?:\/\//);
    const visible = assistantPieces(order[1]).map((piece) => "text" in piece ? piece.text : piece.label).join("");
    assert.match(visible, /Join Zoom meeting/);
    assert.doesNotMatch(visible, /https?:\/\//);
    assert.equal(assistantPieces(order[1]).some((piece) => "href" in piece && piece.href === "https://zoom.us/j/99"), true);
    assert.equal(saved, true);
    assert.doesNotMatch(reply, /Booking now/);
  });

  it("does not save a desk entry or say booked when the stream has no successful booking", async () => {
    let saved = false;
    const failed = await commitZoomBooking({
      advisorId: 7,
      zoomToken: "zoom-token",
      outlookToken: "outlook-token",
      topic: "Meeting",
      localStart: "2026-11-07T15:00:00",
      localEnd: "2026-11-07T15:30:00",
      timeZone: "America/Toronto",
      whenUtc: "",
      minutes: 30,
      label: "Saturday, Nov 7 at 3:00 PM Toronto time",
      advisorEmail: "advisor@example.com",
      clientEmail: "max@example.com",
      clientName: "Max Santiago",
      contactId: 4,
      fetchImpl: async () => new Response("Invalid token", { status: 400 }),
      mail: async () => ({ ok: true as const }),
      saveDesk: async () => {
        saved = true;
      },
    });
    assert.equal(saved, false);
    assert.match(meetingReply(failed), /^Not booked/);
  });
});
