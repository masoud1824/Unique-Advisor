import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBareRefusal, isNewsletterReorder, newsletterMoveTarget } from "./advisor-intent.ts";
import {
  cancelExplanation,
  claimVoiceTurn,
  deliverSpokenLines,
  deskTurnKey,
  isEcho,
  prepareDeskCommand,
  releaseVoiceTurn,
  repeatsRequest,
  resetVoiceTurns,
  shouldBargeIn,
  spokenBrief,
  transcriptHold,
  verifiedFarsiMoveNote,
  voiceAudible,
  voicePlaybackNote,
  preferredBrowserVoice,
  voiceTurnKey,
} from "./voice-desk.ts";
import { OUTBOUND_BLOCKED } from "./outbound-guard.ts";
import { speechRequest, NEUTRAL_NORTH_AMERICAN_DELIVERY, OPENAI_TTS_MODEL } from "./openai-voices.ts";

describe("voice and typing share one command", () => {
  it("maps a short Farsi edit and leaves a long Farsi letter alone", () => {
    assert.equal(
      prepareDeskCommand("مقاله دوم را کوتاه کن"),
      "Shorten the second article. Keep everything else unchanged. Do not send.",
    );
    const letter = `عزیز، ${"این یک نامهٔ بلند است و نباید به دستور تبدیل شود. ".repeat(8)}`;
    assert.equal(prepareDeskCommand(letter), letter.trim());
  });

  it("expands move it up from the article already in focus", () => {
    const last = "Updated “Test Newsletter”. “Retirement Planning” is now article 2. The wording was not changed. Nothing was sent.";
    const command = prepareDeskCommand("move it up", last);
    assert.match(command, /Move “Retirement Planning” up one position/);
    assert.match(command, /wording unchanged/);
    assert.match(command, /Do not send/);
    assert.match(prepareDeskCommand("این را بالا ببر", last), /Move “Retirement Planning” up one position/);
    assert.equal(prepareDeskCommand("move it up", "Which article?"), "move it up");
    const farsiMove = "مقاله چهارم را به جایگاه دوم منتقل کن. متن مقاله‌ها را تغییر نده و ارسال نکن.";
    const mapped = prepareDeskCommand(farsiMove);
    assert.equal(mapped, "Move the fourth article to the second position. Keep every article’s wording unchanged. Do not send.");
    assert.equal(isNewsletterReorder(mapped), true);
    assert.deepEqual(newsletterMoveTarget(mapped), { name: "", to: 1, sourceIndex: 3, relative: 0 });
    assert.equal(verifiedFarsiMoveNote(farsiMove, "I did not save it."), "");
    assert.match(verifiedFarsiMoveNote(farsiMove, "I read the saved newsletter. “Time Value Of Money” is now article 2."), /ذخیره‌شده/);
  });

  it("speaks a short brief unless the person asked to hear the whole draft", () => {
    const letter = `Dear Casey. ${"The second paragraph stays available for a revision and is not a client record. ".repeat(8)}Nothing was sent.`;
    const brief = spokenBrief(letter, "shorten the second paragraph");
    assert.ok(brief.length < letter.length / 2);
    assert.match(brief, /on the screen/);
    assert.doesNotMatch(brief, /Nothing was sent/);
    const aloud = spokenBrief(letter, "read it aloud");
    assert.match(aloud, /second paragraph stays available/);
    const farsi = spokenBrief("Preview is ready. Nothing was sent.", "تقویم را نشان بده");
    assert.match(farsi, /پیش‌نمایش روی صفحه است/);
  });

  it("holds an unclear email, amount, or meeting time and lets a clear request through", () => {
    const email = transcriptHold("send the card to alex at gmail dot com");
    assert.ok(email);
    assert.match(email?.suggestion || "", /alex@gmail.com/);
    assert.match(transcriptHold("the premium is about 500 dollars")?.question || "", /amount/i);
    assert.match(transcriptHold("book a meeting Tuesday or Wednesday")?.question || "", /date or time/i);
    assert.equal(transcriptHold("shorten the second article"), null);
    assert.equal(transcriptHold("email alex@gmail.com the note"), null);
    assert.equal(transcriptHold("book tomorrow at 3 pm"), null);
    assert.equal(transcriptHold("the gift is $500"), null);
    assert.equal(transcriptHold("show my calendar and do not book"), null);
  });

  it("explains a finished action cannot be cancelled", () => {
    assert.match(cancelExplanation({ pending: 1, completed: "" }), /Nothing was sent/);
    assert.match(cancelExplanation({ pending: 0, completed: "email (test)" }), /cannot cancel/);
    assert.match(cancelExplanation({ pending: 2, completed: "email (test)" }), /already finished/);
    assert.match(cancelExplanation({ pending: 0, completed: "" }), /Nothing was waiting/);
  });

  it("blocks the same utterance while it is in flight and for four seconds after", () => {
    resetVoiceTurns();
    const key = voiceTurnKey(1, 2, "Move it up");
    assert.equal(claimVoiceTurn(key, 1_000), true);
    assert.equal(claimVoiceTurn(key, 2_000), false);
    releaseVoiceTurn(key);
    assert.equal(claimVoiceTurn(key, 2_000), false);
    assert.equal(claimVoiceTurn(key, 6_000), true);
    resetVoiceTurns();
  });

  it("treats yes after a new assistant line as a different turn", () => {
    resetVoiceTurns();
    const identity = deskTurnKey(1, 2, "Did you mean the Birthday Wishes card for Jordan Example?", "Yes");
    const preview = deskTurnKey(1, 2, "Just to confirm: send the Birthday Wishes e-card to Jordan Example?", "Yes");
    assert.notEqual(identity, preview);
    assert.equal(claimVoiceTurn(identity, 1_000), true);
    assert.equal(claimVoiceTurn(preview, 1_200), true);
    assert.equal(claimVoiceTurn(preview, 1_400), false);
    resetVoiceTurns();
  });

  it("ignores an echo of the line just spoken", () => {
    assert.equal(isEcho("the preview is on the screen now", "The preview is on the screen now. The rest is on the screen."), true);
    assert.equal(isEcho("move the second article up please", "The preview is on the screen now."), false);
  });
});

describe("voice uses the same refusal and reorder rules as typing", () => {
  it("keeps a preview that says do not send, and treats move it up as a reorder", () => {
    assert.equal(isBareRefusal("Preview the Thank You card. Do not send."), false);
    assert.equal(isBareRefusal("Do not send."), true);
    assert.equal(isBareRefusal("نفرست"), true);
    assert.equal(isNewsletterReorder("move it up"), true);
    assert.equal(newsletterMoveTarget("move it up").relative, -1);
    assert.equal(newsletterMoveTarget("Move “Time Value of Money” to position 2").relative, 0);
  });
});

describe("spoken reply playback", () => {
  it("counts a clip only after play is accepted and ignores a repeated read", () => {
    assert.equal(voiceAudible([{ started: true, dropped: false, blocked: false }]), true);
    assert.equal(voiceAudible([{ started: false, dropped: false, blocked: true }]), false);
    assert.equal(voiceAudible([]), false);
    assert.equal(repeatsRequest("Hello. Please say hello back.", "Hello. Please say hello back."), true);
    assert.equal(shouldBargeIn("Hello. Please say hello back.", "", "Hello. Please say hello back."), false);
    assert.equal(shouldBargeIn("Show the calendar for tomorrow morning", "The preview is on the screen.", "list my contacts"), true);
    const body = JSON.parse(speechRequest("Hello.", "ash")) as { model: string; voice: string; instructions: string };
    assert.equal(body.model, OPENAI_TTS_MODEL);
    assert.equal(body.voice, "ash");
    assert.equal(body.instructions, NEUTRAL_NORTH_AMERICAN_DELIVERY);
    assert.match(body.instructions, /neutral North American English/);
    assert.doesNotMatch(body.instructions, /alloy is British|ash is British|this voice has a British accent/i);
  });

  it("speaks a short hello and a blocked action, and keeps the clip when playback is not heard", async () => {
    assert.match(spokenBrief("Hello.", "Hello. Please say hello back."), /^Hello/);
    const blocked = spokenBrief(OUTBOUND_BLOCKED, "can you get a change of beneficiary form from Equitable Life form library");
    assert.match(blocked, /Nothing was sent/);
    assert.doesNotMatch(blocked, /^$/);
    const events: Array<{ type: string; audio?: string; error?: string }> = [];
    const hello = await deliverSpokenLines(["Hello."], async () => "aGVsbG8=", (event) => events.push(event));
    assert.equal(hello.sentAudio, true);
    assert.equal(events[0]?.type, "audio");
    events.length = 0;
    let released = false;
    const slow = deliverSpokenLines(["Outbound mail is blocked. Nothing was sent."], async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      released = true;
      return "YmxvY2tlZA==";
    }, (event) => events.push(event));
    assert.equal(released, false);
    const done = await slow;
    assert.equal(done.sentAudio, true);
    assert.equal(events.some((event) => event.type === "audio" && event.audio === "YmxvY2tlZA=="), true);
    events.length = 0;
    const failed = await deliverSpokenLines(["Hello."], async () => {
      throw new Error("No voice key.");
    }, (event) => events.push(event));
    assert.equal(failed.sentAudio, false);
    assert.equal(events[0]?.type, "tts-error");
    assert.equal(events[0]?.error, "No voice key.");
    assert.equal(voicePlaybackNote({ spoken: true, audible: false, clips: 1, blocked: true, dropped: false }), "The browser blocked playback. Press Play reply.");
    assert.equal(voicePlaybackNote({ spoken: true, audible: false, clips: 0, blocked: false, dropped: false, ttsError: "No voice key." }), "No voice key.");
    assert.equal(voicePlaybackNote({ spoken: true, audible: true, clips: 1, blocked: false, dropped: false }), "");
    assert.equal(voicePlaybackNote({ spoken: true, audible: false, clips: 0, blocked: false, dropped: false }), "No spoken audio came back. Press Play reply.");
    const chosen = preferredBrowserVoice([
      { lang: "fa-IR", name: "Persian" },
      { lang: "en-GB", name: "Daniel" },
      { lang: "en-CA", name: "Alex" },
      { lang: "en-US", name: "Samantha" },
    ]);
    assert.equal(chosen?.lang, "en-US");
    assert.equal(chosen?.name, "Samantha");
    assert.equal(preferredBrowserVoice([{ lang: "en-GB", name: "Daniel" }, { lang: "en-CA", name: "Alex" }])?.name, "Alex");
    assert.equal(preferredBrowserVoice([{ lang: "fa-IR", name: "Persian" }]), null);
  });
});
