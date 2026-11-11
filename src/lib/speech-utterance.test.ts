import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySpeechSegments, emptyUtterance, keepUtterance } from "./speech-utterance.ts";
import { applyChosenName, resolveSpokenContact } from "./contact-match.ts";

describe("speech utterance", () => {
  it("keeps two consecutive final segments instead of replacing the first", () => {
    const first = applySpeechSegments(emptyUtterance(), [{ transcript: "book a meeting with", isFinal: true }], 0);
    const second = applySpeechSegments({ finals: first.finals }, [{ transcript: "Max Santiago tomorrow at 3", isFinal: true }], 0);
    assert.deepEqual(second.finals, ["book a meeting with", "Max Santiago tomorrow at 3"]);
    assert.equal(second.text, "book a meeting with Max Santiago tomorrow at 3");
  });

  it("lets interim text replace only the current segment", () => {
    const booked = applySpeechSegments(emptyUtterance(), [{ transcript: "book a meeting with", isFinal: true }], 0);
    const partial = applySpeechSegments({ finals: booked.finals }, [
      { transcript: "book a meeting with", isFinal: true },
      { transcript: "Ma", isFinal: false },
    ], 1);
    const corrected = applySpeechSegments({ finals: partial.finals }, [
      { transcript: "book a meeting with", isFinal: true },
      { transcript: "Max", isFinal: false },
    ], 1);
    assert.deepEqual(corrected.finals, ["book a meeting with"]);
    assert.equal(corrected.interim, "Max");
    assert.equal(corrected.text, "book a meeting with Max");
    assert.equal(keepUtterance(corrected.text, "Max"), corrected.text);
  });
});

describe("spoken contact names", () => {
  const contacts = [
    { id: 1, name: "Max Santiago" },
    { id: 2, name: "Max Chen" },
    { id: 3, name: "Lina Patel" },
  ];

  it("uses one confident contact and rewrites the line to the full name", () => {
    const hit = resolveSpokenContact("book a zoom with maks santiago tomorrow at 3", contacts);
    assert.equal(hit.kind, "one");
    if (hit.kind !== "one") return;
    assert.equal(hit.name, "Max Santiago");
    assert.match(hit.text, /Max Santiago/);
    assert.doesNotMatch(hit.text, /maks/i);
  });

  it("asks which contact when several names match", () => {
    const hit = resolveSpokenContact("book a zoom with Max", contacts);
    assert.equal(hit.kind, "many");
    if (hit.kind !== "many") return;
    assert.equal(hit.question, "Did you mean Max Chen or Max Santiago?");
    assert.deepEqual(hit.names, ["Max Chen", "Max Santiago"]);
    assert.equal(applyChosenName("book a zoom with Max", hit.start, hit.end, "Max Santiago"), "book a zoom with Max Santiago");
  });

  it("rewrites Masood, Massoud, and a short last name to Masoud Zangeneh", () => {
    const contacts = [{ id: 4, name: "Masoud Zangeneh" }];
    for (const line of [
      "send a thank you card to Masood Zangene",
      "send a thank you card to massoud",
      "send a thank you card to Masood Zangeneh",
      "send a thank you card to Masood Zang",
    ]) {
      const hit = resolveSpokenContact(line, contacts);
      assert.equal(hit.kind, "one");
      if (hit.kind !== "one") return;
      assert.equal(hit.name, "Masoud Zangeneh");
      assert.match(hit.text, /Masoud Zangeneh/);
      assert.doesNotMatch(hit.text, /masood|massoud/i);
    }
    const missing = resolveSpokenContact("send a thank you card to Bob Smith", contacts);
    assert.equal(missing.kind, "ask");
    if (missing.kind === "ask") assert.match(missing.question, /Which contact/);
  });
});
