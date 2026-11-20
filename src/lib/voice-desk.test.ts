import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBareRefusal, isNewsletterReorder, newsletterMoveTarget } from "./advisor-intent.ts";
import {
  cancelExplanation,
  claimVoiceTurn,
  isEcho,
  prepareDeskCommand,
  releaseVoiceTurn,
  resetVoiceTurns,
  spokenBrief,
  transcriptHold,
  verifiedFarsiMoveNote,
  voiceTurnKey,
} from "./voice-desk.ts";

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
