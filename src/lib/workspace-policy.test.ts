import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCampaignAsk, taskKind } from "./advisor-intent.ts";
import { orchestrationControl } from "./orchestration.ts";
import { contentHoldKind, deliveryRequested } from "./workspace-policy.ts";

describe("workspace holds", () => {
  const samples = [
    ["Move “Time Value of Money” to the second position. Keep every article’s wording unchanged and show the updated preview. Do not send.", "newsletter"],
    ["Preview the Acceptance — Retirement Note. Do not send.", "e-letter"],
    ["Preview the Thank You card. Do not send.", "e-card"],
    ["Preview the Acceptance — Welcome Drip. Do not start it.", "campaign"],
    ["Preview the ivari form from Useful Links. Do not send.", "form"],
    ["Show the Assistant Test document. Do not send.", "document"],
    ["Preview the signature request. Do not send.", "signature"],
    ["Show the test email preview. Do not send.", "email"],
    ["Show my calendar. Do not book a meeting.", "calendar"],
  ] as const;

  for (const [line, kind] of samples) {
    it(`keeps ${kind} off the model and does not require a recipient`, () => {
      assert.equal(deliveryRequested(line), false);
      assert.equal(contentHoldKind(line), kind);
      assert.equal(taskKind(line), kind);
      const control = orchestrationControl(line);
      assert.equal(control.desk, true);
      assert.equal(control.conversational, false);
    });
  }

  it("still treats a real send as delivery", () => {
    const line = "Send the newsletter to Casey Sample";
    assert.equal(deliveryRequested(line), true);
    assert.equal(contentHoldKind(line), "");
    assert.equal(isCampaignAsk("Preview the welcome drip. Do not start it."), false);
    assert.equal(isCampaignAsk("Run the welcome drip campaign for life insurance clients every week"), true);
  });
});
