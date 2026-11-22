import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { controlSavedDrip, deliverApproved, dispatchDripStep, ingestDocumentReplies, reviewAndBook, runDeskCancellation } from "./workflow-entry.ts";

const packet = {
  kind: "newsletter" as const,
  recipients: [
    { name: "Casey Sample", email: "casey.sample@example.invalid" },
    { name: "Riley Sample", email: "riley.sample@example.invalid" },
  ],
  subject: "Test Newsletter",
  design: "pine",
  body: JSON.stringify([{ title: "Time Value of Money", body: "Saved article." }]),
  attachments: ["hash-a"],
};

describe("workflow entry points used by the desk handlers", () => {
  it("runDeskCancellation, called by directAdvisorCommand and applyOrchestration, keeps every saved row", async () => {
    const drafts = [
      { id: 4, status: "pending", approval_state: "pending", body: "Dear Riley. The saved paragraph stays." },
      { id: 5, status: "unsent", approval_state: "withdrawn", body: "Older draft." },
    ];
    const letters = [{ id: 1, body: "Five article newsletter" }, { id: 2, body: "Four article newsletter" }];
    const actions = [{ id: 8, status: "pending", kind: "newsletter-preview" }];
    let deleted = 0;
    const result = await runDeskCancellation({
      listDrafts: async () => drafts.map((row) => ({ ...row })),
      listLetters: async () => letters.map((row) => ({ ...row })),
      writeDraft: async (row) => {
        const found = drafts.find((item) => item.id === row.id);
        if (!found) deleted += 1;
        else Object.assign(found, row);
      },
      listActions: async () => actions.map((row) => ({ ...row })),
      writeAction: async (row) => {
        const found = actions.find((item) => item.id === row.id);
        if (!found) deleted += 1;
        else Object.assign(found, row);
      },
    });
    assert.equal(result.ok, true);
    assert.equal(deleted, 0);
    assert.equal(drafts.length, 2);
    assert.equal(letters.length, 2);
    assert.equal(drafts[0].status, "unsent");
    assert.equal(drafts[0].approval_state, "withdrawn");
    assert.equal(drafts[0].body, "Dear Riley. The saved paragraph stays.");
    assert.equal(letters[0].body, "Five article newsletter");
    assert.equal(letters[1].body, "Four article newsletter");
    assert.equal(actions[0].status, "discarded");
  });

  it("deliverApproved sends one recipient at a time and does not resend an unknown result", async () => {
    const outcomes = {};
    let calls = 0;
    const saveOutcome = async (email, outcome) => { outcomes[email.toLowerCase()] = outcome; };
    const changed = await deliverApproved({
      approved: packet, current: { ...packet, attachments: ["hash-b"] }, isolated: false, outcomes, saveOutcome,
      sendOne: async () => { calls += 1; return { ok: true }; },
    });
    assert.equal(changed.calls, 0);
    assert.match(changed.reason, /content, attachment, or recipients/i);
    const first = await deliverApproved({
      approved: packet, current: packet, isolated: false, outcomes, saveOutcome,
      sendOne: async (person) => {
        calls += 1;
        if (person.email.startsWith("riley")) return { ok: false, unknown: true };
        return { ok: true };
      },
    });
    assert.deepEqual(first.sent, ["casey.sample@example.invalid"]);
    assert.deepEqual(first.unknown, ["riley.sample@example.invalid"]);
    const second = await deliverApproved({
      approved: packet, current: packet, isolated: false, outcomes, saveOutcome,
      sendOne: async () => { calls += 1; throw new Error("provider"); },
    });
    assert.equal(second.calls, 0);
    assert.deepEqual(second.skipped, ["casey.sample@example.invalid"]);
    assert.deepEqual(second.unknown, ["riley.sample@example.invalid"]);
    assert.equal(calls, 2);
  });

  it("dispatchDripStep, called by sendDripStep, skips unsubscribed and already sent recipients", async () => {
    const contacts = [
      { id: 1, full_name: "Casey Sample", email: "casey.sample@example.invalid", tags: "Life Insurance Client" },
      { id: 2, full_name: "Quinn Sample", email: "quinn.sample@example.invalid", tags: "Life Insurance Client, Unsubscribed" },
      { id: 3, full_name: "Avery Sample", email: "", tags: "Life Insurance Client" },
    ];
    let calls = 0;
    const isolated = await dispatchDripStep({
      isolated: true,
      contacts,
      chosenIds: [1, 2, 3],
      tag: "",
      priorSent: [],
      send: async () => { calls += 1; throw new Error("provider"); },
    });
    assert.equal(isolated.calls, 0);
    assert.match(isolated.error, /isolated test copy/i);
    const first = await dispatchDripStep({
      isolated: false,
      contacts,
      chosenIds: [1, 2, 3],
      tag: "",
      priorSent: [],
      send: async (contact) => {
        calls += 1;
        assert.equal(contact.full_name, "Casey Sample");
        return { ok: false, error: "mailbox refused" };
      },
    });
    assert.equal(first.blocked.map((item) => item.name).join(","), "Quinn Sample,Avery Sample");
    assert.equal(first.sent.length, 0);
    const second = await dispatchDripStep({
      isolated: false,
      contacts,
      chosenIds: [1, 2, 3],
      tag: "",
      priorSent: [],
      send: async (contact) => {
        calls += 1;
        assert.equal(contact.email, "casey.sample@example.invalid");
        return { ok: true };
      },
    });
    assert.deepEqual(second.sent, ["casey.sample@example.invalid"]);
    const third = await dispatchDripStep({
      isolated: false,
      contacts,
      chosenIds: [1, 2, 3],
      tag: "",
      priorSent: second.sent,
      send: async () => { calls += 1; throw new Error("provider"); },
    });
    assert.equal(third.calls, 0);
    assert.deepEqual(third.skipped, ["casey.sample@example.invalid"]);
    assert.equal(calls, 2);
  });

  it("controlSavedDrip, called by holdCampaign, pauses, refuses resume, cancels, and unsubscribes without deleting the row", () => {
    const saved = {
      id: 9,
      name: "Acceptance — Welcome Drip",
      active: false,
      status: "saved" as const,
      steps: ["Welcome", "Follow up"],
      recipients: [
        { name: "Casey Sample", email: "casey.sample@example.invalid", unsubscribed: false },
        { name: "Quinn Sample", email: "quinn.sample@example.invalid", unsubscribed: true },
      ],
    };
    const paused = controlSavedDrip(saved, "pause");
    assert.equal(paused.deleted, false);
    assert.equal(paused.started, false);
    assert.equal(paused.state.id, 9);
    assert.deepEqual(paused.state.steps, saved.steps);
    const resumed = controlSavedDrip(paused.state, "resume");
    assert.equal(resumed.started, false);
    assert.equal(resumed.state.active, false);
    assert.match(resumed.reply, /did not start/i);
    const cancelled = controlSavedDrip(saved, "cancel");
    assert.equal(cancelled.deleted, false);
    assert.equal(cancelled.state.id, 9);
    assert.equal(cancelled.state.status, "cancelled");
    const unsubscribed = controlSavedDrip(saved, "unsubscribe", "Casey Sample");
    assert.equal(unsubscribed.state.recipients.length, 2);
    assert.equal(unsubscribed.state.recipients[0].unsubscribed, true);
    assert.match(unsubscribed.reply, /not deleted/i);
  });

  it("ingestDocumentReplies, called by checkDocumentReplies, stores one notice and ignores the same reply", async () => {
    const seen: string[] = [];
    const messages = [
      { id: "sent-1", conversationId: "thread-1", from: "desk@example.invalid" },
      { id: "reply-1", conversationId: "thread-1", from: "reviewer@example.invalid" },
      { id: "other", conversationId: "thread-2", from: "reviewer@example.invalid" },
    ];
    const first = await ingestDocumentReplies({
      conversationId: "thread-1",
      sentMessageId: "sent-1",
      sender: "desk@example.invalid",
      seenIds: seen,
      messages,
      remember: async (notice) => {
        if (seen.includes(notice.messageId)) return false;
        seen.push(notice.messageId);
        return true;
      },
    });
    assert.equal(first.stored, 1);
    assert.deepEqual(seen, ["reply-1"]);
    const second = await ingestDocumentReplies({
      conversationId: "thread-1",
      sentMessageId: "sent-1",
      sender: "desk@example.invalid",
      seenIds: seen,
      messages,
      remember: async () => { throw new Error("provider"); },
    });
    assert.equal(second.stored, 0);
    assert.equal(second.created.length, 0);
  });

  it("reviewAndBook, called by placePending, blocks hours, buffer, time zone, and a second conflict before commit", async () => {
    let commits = 0;
    const commit = async () => { commits += 1; return { ok: true }; };
    const early = await reviewAndBook({
      start: "2026-12-02T08:00:00",
      minutes: 45,
      zone: "America/Toronto",
      officeZone: "America/Toronto",
      isolated: false,
      loadEvents: async () => [],
      commit,
    });
    assert.equal(early.commitCalled, false);
    assert.match(early.reason, /working hours/i);
    const buffered = await reviewAndBook({
      start: "2026-12-02T11:15:00",
      minutes: 45,
      zone: "America/Toronto",
      officeZone: "America/Toronto",
      isolated: false,
      loadEvents: async () => [{ start: "2026-12-02T10:30:00", end: "2026-12-02T11:10:00", title: "Existing review" }],
      commit,
    });
    assert.equal(buffered.commitCalled, false);
    assert.match(buffered.reason, /buffer/i);
    const otherZone = await reviewAndBook({
      start: "2026-12-02T11:15:00",
      minutes: 45,
      zone: "America/Vancouver",
      officeZone: "America/Toronto",
      isolated: false,
      loadEvents: async () => [],
      commit,
    });
    assert.equal(otherZone.commitCalled, false);
    assert.match(otherZone.reason, /America\/Toronto/);
    let look = 0;
    const second = await reviewAndBook({
      start: "2026-12-02T11:15:00",
      minutes: 45,
      zone: "America/Toronto",
      officeZone: "America/Toronto",
      isolated: false,
      loadEvents: async () => {
        look += 1;
        return look < 2 ? [] : [{ start: "2026-12-02T11:20:00", end: "2026-12-02T12:00:00", title: "Training overlap" }];
      },
      commit,
    });
    assert.equal(second.commitCalled, false);
    assert.match(second.reason, /second check/i);
    const isolated = await reviewAndBook({
      start: "2026-12-02T11:15:00",
      minutes: 45,
      zone: "America/Toronto",
      officeZone: "America/Toronto",
      isolated: true,
      loadEvents: async () => [],
      commit,
    });
    assert.equal(isolated.commitCalled, false);
    assert.match(isolated.reason, /isolated test copy/i);
    const clear = await reviewAndBook({
      start: "2026-12-02T11:15:00",
      minutes: 45,
      zone: "America/Toronto",
      officeZone: "America/Toronto",
      isolated: false,
      loadEvents: async () => [],
      commit,
    });
    assert.equal(clear.commitCalled, true);
    assert.equal(clear.booked, true);
    assert.equal(commits, 1);
  });
});
