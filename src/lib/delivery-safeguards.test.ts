import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCancellation, applyDripControl, packetFingerprint, planPartialRetry, reviewProposedSlot, runRecipientAttempts } from "./delivery-safeguards.ts";
import { noticesToCreate, planReplyNotices, reviewedTestDecision, REVIEWED_ADVISOR, REVIEWED_APPROVAL, REVIEWED_ATTACHMENT } from "./document-mail.ts";

describe("offline delivery safeguards", () => {
  it("cancellation preserves saved draft rows and letter text", () => {
    const drafts = [
      { id: 4, status: "pending", approval_state: "pending", body: "Dear Riley. The saved paragraph stays." },
      { id: 5, status: "unsent", approval_state: "withdrawn", body: "Older draft." },
    ];
    const letters = [{ id: 1, body: "Five article newsletter" }, { id: 2, body: "Four article newsletter" }];
    const result = applyCancellation(drafts, letters);
    assert.equal(result.deletesRows, false);
    assert.deepEqual(result.deletedDraftIds, []);
    assert.deepEqual(result.deletedLetterIds, []);
    assert.equal(result.drafts.length, 2);
    assert.equal(result.letters.length, 2);
    assert.equal(result.drafts[0].status, "unsent");
    assert.equal(result.drafts[0].approval_state, "withdrawn");
    assert.equal(result.drafts[0].body, drafts[0].body);
    assert.equal(result.drafts[1].body, "Older draft.");
    assert.equal(result.letters[0].body, "Five article newsletter");
    assert.equal(result.letters[1].body, "Four article newsletter");
  });

  it("invalidates approval when the attachment version changes and retries only the failed recipient", () => {
    const packet = { recipients: ["casey", "quinn"], body: "Welcome", attachmentHash: "hash-a" };
    const approved = packetFingerprint(packet);
    const changed = planPartialRetry({ approvedFingerprint: approved, packet: { ...packet, attachmentHash: "hash-b" }, prior: [] });
    assert.equal(changed.ok, false);
    assert.match(changed.reason, /no longer applies/i);
    assert.deepEqual(changed.retry, []);
    const partial = planPartialRetry({
      approvedFingerprint: approved,
      packet,
      prior: [{ id: "casey", ok: true }, { id: "quinn", ok: false, error: "mailbox refused" }],
    });
    assert.equal(partial.ok, true);
    assert.deepEqual(partial.retry, ["quinn"]);
    assert.deepEqual(partial.skipped, ["casey"]);
    const seen = new Set<string>(["casey"]);
    let calls = 0;
    const first = runRecipientAttempts(partial.retry, (id) => {
      calls += 1;
      return { id, ok: false, error: "mailbox refused" };
    }, seen);
    assert.equal(calls, 1);
    assert.equal(seen.has("quinn"), false);
    const second = runRecipientAttempts(["quinn"], (id) => {
      calls += 1;
      return { id, ok: true };
    }, seen);
    assert.equal(second[0].ok, true);
    assert.equal(calls, 2);
    const duplicate = runRecipientAttempts(["quinn", "casey"], () => {
      calls += 1;
      return { id: "should-not-run", ok: true };
    }, seen);
    assert.equal(calls, 2);
    assert.match(duplicate[0].error || "", /did not send it again/i);
    assert.match(duplicate[1].error || "", /did not send it again/i);
    const exact = reviewedTestDecision({
      advisorSlug: REVIEWED_ADVISOR,
      sender: "advisor@example.com",
      to: ["masoudz@outlook.com"],
      attachment: REVIEWED_ATTACHMENT,
      approvalText: REVIEWED_APPROVAL,
      alreadySent: false,
    });
    assert.equal(exact.ok, true);
    assert.equal(reviewedTestDecision({
      advisorSlug: REVIEWED_ADVISOR,
      sender: "advisor@example.com",
      to: ["masoudz@outlook.com"],
      attachment: { ...REVIEWED_ATTACHMENT, hash: "different" },
      approvalText: REVIEWED_APPROVAL,
      alreadySent: false,
    }).ok, false);
  });

  it("dedupes reply notices for the same message", () => {
    const messages = [
      { id: "sent-1", conversationId: "thread-1", from: "info@zangenehlaw.ca" },
      { id: "reply-1", conversationId: "thread-1", from: "masoudz@outlook.com" },
      { id: "other", conversationId: "thread-2", from: "masoudz@outlook.com" },
    ];
    const planned = planReplyNotices({ conversationId: "thread-1", sentMessageId: "sent-1", sender: "info@zangenehlaw.ca", seen: [], messages });
    const first = noticesToCreate(planned, []);
    const second = noticesToCreate(planned, first.map((item) => item.messageId));
    assert.deepEqual(first.map((item) => item.messageId), ["reply-1"]);
    assert.deepEqual(second, []);
  });

  it("pauses, refuses a live resume, cancels, and unsubscribes without deleting the drip", () => {
    const saved = {
      id: 9,
      name: "Acceptance — Welcome Drip",
      active: false,
      status: "saved" as const,
      steps: ["day 0", "day 3"],
      recipients: [
        { name: "Casey Sample", email: "casey.sample@example.invalid", unsubscribed: false },
        { name: "Quinn Sample", email: "quinn.sample@example.invalid", unsubscribed: true },
      ],
    };
    const paused = applyDripControl(saved, "pause");
    assert.equal(paused.deleted, false);
    assert.equal(paused.state.active, false);
    assert.equal(paused.state.status, "paused");
    assert.deepEqual(paused.state.steps, saved.steps);
    assert.match(paused.reply, /paused/i);
    const resumed = applyDripControl(paused.state, "resume");
    assert.equal(resumed.state.active, false);
    assert.match(resumed.reply, /did not start/i);
    const cancelled = applyDripControl(paused.state, "cancel");
    assert.equal(cancelled.state.id, 9);
    assert.equal(cancelled.state.status, "cancelled");
    assert.equal(cancelled.deleted, false);
    assert.deepEqual(cancelled.state.steps, ["day 0", "day 3"]);
    const unsubscribed = applyDripControl(saved, "unsubscribe", "Casey Sample");
    assert.equal(unsubscribed.state.recipients.find((row) => row.name === "Casey Sample")?.unsubscribed, true);
    assert.equal(unsubscribed.state.recipients.length, 2);
    assert.match(unsubscribed.reply, /unsubscribed/i);
    assert.match(unsubscribed.reply, /not deleted/i);
  });

  it("checks working hours, buffer, time zone, then a second conflict, and does not book", () => {
    const base = {
      start: "2026-12-02T11:15",
      minutes: 45,
      zone: "America/Toronto",
      openMinute: 9 * 60,
      closeMinute: 17 * 60,
      bufferMinutes: 15,
      firstLook: [] as Array<{ start: string; end: string; title: string }>,
      secondLook: [] as Array<{ start: string; end: string; title: string }>,
    };
    const clear = reviewProposedSlot(base);
    assert.equal(clear.ok, true);
    assert.equal(clear.booked, false);
    assert.match(clear.reason, /did not book/i);
    const early = reviewProposedSlot({ ...base, start: "2026-12-02T08:00" });
    assert.equal(early.ok, false);
    assert.match(early.reason, /working hours/i);
    const buffered = reviewProposedSlot({
      ...base,
      firstLook: [{ start: "2026-12-02T10:30", end: "2026-12-02T11:10", title: "Existing review" }],
    });
    assert.equal(buffered.ok, false);
    assert.match(buffered.reason, /buffer/i);
    const otherZone = reviewProposedSlot({ ...base, zone: "America/Vancouver" });
    assert.equal(otherZone.ok, false);
    assert.match(otherZone.reason, /America\/Toronto/i);
    const second = reviewProposedSlot({
      ...base,
      secondLook: [{ start: "2026-12-02T11:20", end: "2026-12-02T12:00", title: "Training overlap" }],
    });
    assert.equal(second.ok, false);
    assert.equal(second.booked, false);
    assert.match(second.reason, /second check/i);
    assert.match(second.reason, /Training overlap/);
  });
});
