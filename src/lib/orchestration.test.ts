import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { modelContext, orchestrationControl, resolveConfirmation } from "./orchestration.ts";

describe("orchestration controls", () => {
  it("keeps a revision on the model and only withdraws approval", () => {
    const edit = "Replace the second point with the document follow-up. Show only the updated list. Do not search or send anything.";
    const control = orchestrationControl(edit);
    assert.equal(control.conversational, true);
    assert.equal(control.invalidateApproval, true);
    assert.equal(control.cancelStaged, false);
    assert.equal(control.parkDraft, false);
    assert.equal(control.blockLookups, true);
    assert.equal(control.desk, false);
    assert.equal(control.confirm, false);
  });

  it("parks a draft when the task changes and does not cancel unrelated work", () => {
    const plan = "Leave that email as an unsent draft. What should I handle first tomorrow? Three priorities. Do not search or schedule anything.";
    const control = orchestrationControl(plan);
    assert.equal(control.conversational, true);
    assert.equal(control.parkDraft, true);
    assert.equal(control.cancelStaged, false);
    assert.equal(control.invalidateApproval, false);
    assert.equal(control.blockLookups, true);
  });

  it("does not touch pending work when the only limit is no new search", () => {
    const control = orchestrationControl("Do not search the calendar or the contacts. Use what is already in this conversation.");
    assert.equal(control.blockLookups, true);
    assert.equal(control.cancelStaged, false);
    assert.equal(control.parkDraft, false);
    assert.equal(control.invalidateApproval, false);
    assert.equal(control.conversational, true);
  });

  it("cancels a staged send without turning the reply into a new draft", () => {
    const control = orchestrationControl("Cancel the pending card.");
    assert.equal(control.cancelStaged, true);
    assert.equal(control.conversational, false);
    assert.equal(control.parkDraft, false);
  });

  it("keeps a calendar lookup as a desk tool and a follow-up as conversation", () => {
    assert.equal(orchestrationControl("Show my appointments for today").desk, true);
    const follow = orchestrationControl("Who is that appointment with?");
    assert.equal(follow.conversational, true);
    assert.equal(follow.desk, false);
    assert.equal(follow.blockLookups, true);
  });

  it("resolves a real staged action and rejects missing, stale, and ambiguous answers", () => {
    const staged = { id: 4, kind: "card", status: "pending", approval: "pending" };
    assert.deepEqual(resolveConfirmation("yes", [staged]), { action: "send", id: 4, kind: "card" });
    assert.equal(resolveConfirmation("yes", []).action, "missing");
    assert.equal(resolveConfirmation("Send it.", [{ id: 4, kind: "card", status: "stale", approval: "withdrawn" }]).action, "stale");
    const ambiguous = resolveConfirmation("yes", [
      { id: 4, kind: "card", status: "pending", approval: "pending" },
      { id: 9, kind: "draft", status: "pending", approval: "pending" },
    ]);
    assert.equal(ambiguous.action, "ambiguous");
    assert.equal(resolveConfirmation("Rewrite the note under 30 words.", [staged]).action, "none");
  });

  it("separates draft text from approval metadata", () => {
    const note = modelContext({
      blockLookups: true,
      drafts: [{ id: 3, subject: "Welcome", body: "Hello Mina.", status: "unsent", approval: "withdrawn" }],
      actions: [{ id: 8, kind: "card", status: "pending", approval: "pending" }],
    });
    assert.match(note, /Draft content:\n#3\nWelcome\nHello Mina\./);
    assert.match(note, /Approval metadata:\n#8 card status=pending approval=pending/);
    assert.match(note, /Do not call tools/);
    assert.doesNotMatch(note, /Nothing was searched/);
  });
});
