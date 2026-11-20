import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assistantPieces, spokenReply } from "./assistant-reply.ts";

describe("assistant zoom link", () => {
  it("shows a labelled link and does not speak the address", () => {
    const raw = "Booked for Monday, Nov 9 at 2:00 PM Toronto time. Zoom join link: https://us06web.zoom.us/j/123?pwd=ab. It is on the calendar.";
    const visible = assistantPieces(raw).map((piece) => "text" in piece ? piece.text : piece.label).join("");
    const link = assistantPieces(raw).find((piece) => "href" in piece);
    assert.match(visible, /Join Zoom meeting/);
    assert.doesNotMatch(visible, /https?:\/\//);
    assert.equal(link && "href" in link ? link.href : "", "https://us06web.zoom.us/j/123?pwd=ab");
    const said = spokenReply(raw);
    assert.match(said, /the Zoom link is in the chat/);
    assert.doesNotMatch(said, /https?:\/\//);
    assert.doesNotMatch(said, /us06web/);
  });
});
