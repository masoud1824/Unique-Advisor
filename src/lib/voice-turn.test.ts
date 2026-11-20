import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyLiveStt, emptyLive, emptyTurn, mergeLiveDraft, pushRecognition, shouldAutoSend, turnText } from "./voice-turn.ts";

const full = "Book a Zoom meeting with Max Santiago tomorrow at 3 pm";

describe("voice turn", () => {
  it("keeps both final segments across a 1.5s pause and sends the whole sentence", () => {
    let state = emptyTurn();
    const first = pushRecognition(state, 1, [{ transcript: "Book a Zoom meeting with Max Santiago", isFinal: true }]);
    state = first.state;
    assert.equal(shouldAutoSend(false, 1500), false);
    assert.equal(shouldAutoSend(true, 1500), false);
    const second = pushRecognition(state, 1, [
      { transcript: "Book a Zoom meeting with Max Santiago", isFinal: true },
      { transcript: "tomorrow at 3 pm", isFinal: true },
    ]);
    assert.equal(second.text, full);
    assert.equal(mergeLiveDraft(first.text, "tomorrow at 3 pm"), full);
    assert.equal(mergeLiveDraft(full, "tomorrow at 3 pm"), full);
    const sent = second.text;
    assert.equal(sent, full);
  });

  it("keeps the first segment when speech recognition reconnects", () => {
    let state = emptyTurn();
    const first = pushRecognition(state, 1, [{ transcript: "Book a Zoom meeting with Max Santiago", isFinal: true }]);
    state = first.state;
    const second = pushRecognition(state, 2, [{ transcript: "tomorrow at 3 pm", isFinal: true }]);
    assert.equal(second.text, full);
    assert.equal(turnText(second.state), full);
    assert.equal(mergeLiveDraft(first.text, second.text), full);
    assert.notEqual(second.text, "tomorrow at 3 pm");
  });

  it("replaces the current interim instead of repeating words", () => {
    let state = emptyTurn();
    for (const said of ["book", "book a", "book a zoom"]) {
      const next = pushRecognition(state, 1, [{ transcript: said, isFinal: false }]);
      state = next.state;
      assert.equal(next.text, said);
      assert.doesNotMatch(next.text, /book book/);
    }
    const piled = pushRecognition(emptyTurn(), 1, [
      { transcript: "book", isFinal: false },
      { transcript: "book a", isFinal: false },
      { transcript: "book a zoom", isFinal: false },
    ]);
    assert.equal(piled.text, "book a zoom");
    const done = pushRecognition(piled.state, 1, [{ transcript: "book a zoom", isFinal: true }]);
    assert.equal(done.text, "book a zoom");
    assert.equal(done.state.interim, "");
    const restarted = pushRecognition(pushRecognition(emptyTurn(), 1, [{ transcript: "book", isFinal: false }]).state, 2, [{ transcript: "book a zoom", isFinal: false }]);
    assert.equal(restarted.text, "book a zoom");
  });

  it("treats cumulative speech events as replacements and ignores a second handler", () => {
    let state = emptyLive(1);
    const steps = [
      [{ id: 0, text: "book", final: false }],
      [{ id: 0, text: "book", final: true }, { id: 1, text: "book a", final: false }],
      [{ id: 0, text: "book", final: true }, { id: 1, text: "book a", final: true }, { id: 2, text: "book a zoom", final: false }],
    ];
    let shown = "";
    for (const segments of steps) {
      const next = applyLiveStt(state, { handler: 1, session: 1, segments });
      state = next.state;
      shown = next.text;
      assert.equal(next.ignored, false);
      assert.doesNotMatch(shown, /book book/);
    }
    assert.equal(shown, "book a zoom");
    const duplicate = applyLiveStt(state, { handler: 2, session: 1, segments: [{ id: 0, text: "book a zoom extra", final: true }] });
    assert.equal(duplicate.ignored, true);
    assert.equal(duplicate.text, "book a zoom");
  });

  it("replaces Chrome revisions and a restart instead of repeating the sentence", () => {
    const phrase = "send a thank you card to Masoud Zangeneh";
    const revisions = [
      phrase,
      "send a thank you card to massoud",
      "send a thank you card to Masood Z",
      "send a thank you card to Masood Zang",
      "send a thank you card to Masood zangene",
    ];
    let state = emptyTurn();
    for (const line of revisions) {
      const next = pushRecognition(state, 1, [{ transcript: line, isFinal: false }]);
      state = next.state;
      assert.equal(next.text.includes("thank you card to") ? next.text.split(/thank you card to/i).length - 1 : 1, 1);
    }
    const restarted = pushRecognition(state, 2, [{ transcript: phrase, isFinal: true }]);
    assert.equal(restarted.text, phrase);
    let committed = pushRecognition(emptyTurn(), 1, [{ transcript: phrase, isFinal: true }]).state;
    for (const [index, line] of revisions.slice(1).entries()) {
      const next = pushRecognition(committed, index + 2, [{ transcript: line, isFinal: true }]);
      committed = next.state;
      assert.equal(next.text, phrase);
    }
  });
});
