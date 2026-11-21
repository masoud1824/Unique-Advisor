import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assistantChatTitle,
  blockedRecipientReply,
  cardAwaitingYes,
  cardConfirmLine,
  contactPhrase,
  interpretIdentityAnswer,
  keepCardCorrection,
  resolveCardCorrection,
} from "./advisor-intent.ts";
import { orchestrationControl, previewApprovalDecision, resolveConfirmation } from "./orchestration.ts";
import { claimVoiceTurn, farsiCardCorrection, prepareDeskCommand, resetVoiceTurns } from "./voice-desk.ts";

const ORIGINAL = "Send a birthday card to Jordan Example. Stop. Send it to Quinn Sample.";
const IDENTITY = "Did you mean the Birthday Wishes card for Jordan Example?";
const PREVIEW = "Just to confirm: send the Birthday Wishes e-card to Jordan Example?";
const STALE = [{ id: 4, kind: "card", status: "stale", approval: "withdrawn" }];
const PENDING = [{ id: 4, kind: "card", status: "pending", approval: "pending" }];

describe("card recipient correction", () => {
  it("keeps the old first-name helper and uses the later recipient after stop", () => {
    assert.equal(contactPhrase(ORIGINAL), "Jordan Example");
    const fix = resolveCardCorrection(ORIGINAL);
    assert.equal(fix?.kind, "use");
    if (fix?.kind === "use") {
      assert.equal(fix.name, "Quinn Sample");
      assert.equal(fix.dropped, "Jordan Example");
    }
    assert.equal(orchestrationControl(ORIGINAL).confirm, false);
    assert.equal(orchestrationControl(ORIGINAL).cancelStaged, false);
    assert.equal(blockedRecipientReply("Quinn Sample", "Acceptance, Unsubscribed, Life Insurance Client", "quinn.sample@example.invalid", "Jordan Example"), "Quinn Sample — Unsubscribed. I cancelled the request for Jordan Example. Nothing was sent.");
    assert.match(blockedRecipientReply("Avery Sample", "Acceptance, Life Insurance Client", "", "Jordan Example"), /No email is recorded/);
    assert.equal(blockedRecipientReply("Casey Sample", "Acceptance, Life Insurance Client", "casey.sample@example.invalid", "Jordan Example"), "");
    const stopped = resolveCardCorrection("Send a birthday card to Jordan Example. Stop.");
    assert.equal(stopped?.kind, "cancelled");
    if (stopped?.kind === "cancelled") assert.match(stopped.reply, /Jordan Example/);
  });

  it("does not keep the first name when two people are named and nobody said stop", () => {
    const fix = resolveCardCorrection("Send a birthday card to Jordan Example. Send it to Quinn Sample.");
    assert.equal(fix?.kind, "ambiguous");
    if (fix?.kind === "ambiguous") {
      assert.deepEqual(fix.names, ["Jordan Example", "Quinn Sample"]);
      assert.match(fix.reply, /did not choose Jordan Example/i);
      assert.match(fix.reply, /Nothing was sent/);
    }
    assert.equal(resolveCardCorrection("Send a birthday card to Jordan Example."), null);
    assert.equal(resolveCardCorrection("Cancel the pending card."), null);
    assert.equal(keepCardCorrection("Cancel the pending card."), false);
    assert.equal(orchestrationControl("Cancel the pending card.").cancelStaged, true);
  });

  it("accepts unseen English and Farsi corrections, including stop last and a changed person", () => {
    const dash = resolveCardCorrection("Please send the birthday card to Jordan Example — stop — the birthday card should go to Riley Sample instead.");
    assert.equal(dash?.kind, "use");
    if (dash?.kind === "use") assert.equal(dash.name, "Riley Sample");
    const refused = resolveCardCorrection("Don't send it to Jordan Example. Send the birthday card to Morgan Sample.");
    assert.equal(refused?.kind, "use");
    if (refused?.kind === "use") {
      assert.equal(refused.name, "Morgan Sample");
      assert.equal(refused.dropped, "Jordan Example");
    }
    const cancelWord = resolveCardCorrection("Send a birthday card to Jordan Example. Cancel. Send it to Casey Sample.");
    assert.equal(cancelWord?.kind, "use");
    if (cancelWord?.kind === "use") assert.equal(cancelWord.name, "Casey Sample");
    assert.equal(keepCardCorrection("Send a birthday card to Jordan Example. Cancel. Send it to Casey Sample."), true);
    const farsi = "کارت تولد را برای جردن بفرست. لغو. آن را برای کوین بفرست.";
    const typed = prepareDeskCommand(farsi);
    const spoken = prepareDeskCommand(` ${farsi} `);
    assert.equal(typed, spoken.trim());
    assert.match(typed, /Quinn Sample/);
    assert.doesNotMatch(typed, /[\u0600-\u06FF]/);
    const fromFarsi = resolveCardCorrection(typed);
    assert.equal(fromFarsi?.kind, "use");
    if (fromFarsi?.kind === "use") assert.equal(fromFarsi.name, "Quinn Sample");
    const avery = prepareDeskCommand("کارت تولد برای جردن. استاپ. برای اِوری بفرست.");
    const averyFix = resolveCardCorrection(avery);
    assert.equal(averyFix?.kind, "use");
    if (averyFix?.kind === "use") assert.equal(averyFix.name, "Avery Sample");
    const casey = prepareDeskCommand("برای جردن کارت تولد بفرست لغو کن برای کیسی بفرست");
    const caseyFix = resolveCardCorrection(casey);
    assert.equal(caseyFix?.kind, "use");
    if (caseyFix?.kind === "use") assert.equal(caseyFix.name, "Casey Sample");
    assert.match(farsiCardCorrection("کارت تولد را برای کیسی بفرست"), /Casey Sample/);
    assert.equal(prepareDeskCommand("مقاله دوم را کوتاه کن"), "Shorten the second article. Keep everything else unchanged. Do not send.");
  });
});

describe("identity confirmation is not delivery approval", () => {
  it("turns yes to the card question into a preview and still rejects a stale rendered preview", () => {
    assert.equal(contactPhrase("Yes."), "Yes");
    const accepted = interpretIdentityAnswer("Yes.", IDENTITY);
    assert.equal(accepted.kind, "accept");
    if (accepted.kind === "accept") {
      assert.equal(accepted.name, "Jordan Example");
      assert.equal(accepted.title, "Birthday Wishes");
      assert.equal(cardConfirmLine(accepted.title, accepted.name), "Just to confirm: send the Birthday Wishes e-card to Jordan Example?");
    }
    const namedYes = interpretIdentityAnswer("Yes, send it to Jordan Example.", IDENTITY);
    assert.equal(namedYes.kind, "accept");
    const changed = interpretIdentityAnswer("Yes, send it to Quinn Sample.", IDENTITY);
    assert.equal(changed.kind, "change");
    if (changed.kind === "change") {
      assert.equal(changed.name, "Quinn Sample");
      assert.equal(changed.previous, "Jordan Example");
    }
    assert.equal(cardAwaitingYes([{ role: "assistant", content: IDENTITY }]), false);
    assert.equal(cardAwaitingYes([{ role: "assistant", content: PREVIEW }]), true);
    assert.equal(previewApprovalDecision("Yes.", IDENTITY, STALE).action, "skip");
    assert.equal(previewApprovalDecision("Yes, send it to Jordan Example.", IDENTITY, STALE).action, "skip");
    assert.equal(previewApprovalDecision("Yes.", PREVIEW, STALE).action, "stale");
    assert.equal(previewApprovalDecision("Send it.", PREVIEW, STALE).action, "stale");
    assert.equal(previewApprovalDecision("Yes.", PREVIEW, PENDING).action, "send");
    assert.equal(previewApprovalDecision("Yes, send it to Riley Sample.", PREVIEW, PENDING).action, "skip");
    assert.equal(resolveConfirmation("Send it.", STALE).action, "stale");
    assert.equal(prepareDeskCommand("بله", IDENTITY), "Yes.");
    assert.equal(prepareDeskCommand("بله، برای کوین بفرست", IDENTITY), "Yes, send it to Quinn Sample.");
    assert.equal(prepareDeskCommand("لغو", IDENTITY), "Cancel.");
    assert.equal(prepareDeskCommand("بله", PREVIEW), "Yes.");
    assert.equal(prepareDeskCommand("بله"), "بله");
  });

  it("blocks a duplicate of the same utterance and leaves a different recipient free", () => {
    resetVoiceTurns();
    const key = "7:3:" + ORIGINAL.toLowerCase();
    assert.equal(claimVoiceTurn(key, 5_000), true);
    assert.equal(claimVoiceTurn(key, 6_000), false);
    assert.equal(claimVoiceTurn("7:3:send a birthday card to riley sample", 6_000), true);
    resetVoiceTurns();
  });
});

describe("previous chat label", () => {
  it("stores the first 42 characters and keeps the clock off the title", () => {
    const full = "Use fictional client C-1001 from /Unique Advisor practice file";
    const title = assistantChatTitle(full);
    assert.equal(title, "Use fictional client C-1001 from /Unique A");
    assert.equal(title.length, 42);
    assert.equal(title.includes("Nov"), false);
    assert.equal(`${title} Nov 21 11:54 AM`.startsWith(title), true);
  });
});
