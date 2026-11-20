import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanVoiceEvents } from "./voice-log-events.ts";

describe("voice logs", () => {
  it("keeps the raw Chrome result fields and drops anything that is not an event", () => {
    const events = cleanVoiceEvents([
      { at: "2026-11-07T17:00:00.000Z", type: "start" },
      { at: "2026-11-07T17:00:01.000Z", type: "result", resultIndex: 0, results: [{ transcript: "send a thank you card", isFinal: false }, { transcript: "send a thank you card to Masoud", isFinal: true }] },
      { at: "2026-11-07T17:00:02.000Z", type: "restart" },
      { type: "nope" },
    ]);
    assert.equal(events.length, 4);
    assert.equal(events[1].type, "result");
    assert.equal(events[1].resultIndex, 0);
    assert.equal(events[1].results?.[1].transcript, "send a thank you card to Masoud");
    assert.equal(events[1].results?.[1].isFinal, true);
    assert.equal(events[2].type, "restart");
    assert.equal(events[3].type, "result");
  });
});
