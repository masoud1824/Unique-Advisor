import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancelPendingDesk,
  checkDocumentReplies,
  holdCampaign,
  placePending,
  runQueuedCampaign,
  sendDripStep,
  sendProposedNewsletter,
  sendQueuedCard,
  sendQueuedEletter,
  type BookingRecord,
  type DeliveryIo,
  type RecipientOutcome,
} from "./desk-handlers.ts";
import type { BusySlot } from "./delivery-safeguards.ts";
import type { FixtureDraft, FixtureLetter } from "./delivery-safeguards.ts";

const articles = [{ title: "Time Value of Money", body: "Saved article." }];
const people = [
  { id: 1, full_name: "Casey Sample", email: "casey.sample@example.invalid", tags: "Life Insurance Client" },
  { id: 2, full_name: "Riley Sample", email: "riley.sample@example.invalid", tags: "Life Insurance Client" },
];

type SendResult = {
  ok: boolean;
  error?: string;
  calls?: number;
  sent?: string[];
  skipped?: string[];
  failed?: Array<{ email: string; error?: string }>;
  unknown?: string[];
};

function delivered(result: SendResult) {
  return {
    ok: result.ok,
    error: result.error || "",
    calls: result.calls ?? 0,
    sent: result.sent ?? [],
    skipped: result.skipped ?? [],
    failed: result.failed ?? [],
    unknown: result.unknown ?? [],
  };
}

function deliveryIo(rows = people) {
  const outcomes: Record<string, RecipientOutcome> = {};
  const calls: string[] = [];
  const io: DeliveryIo = {
    isolated: false,
    practiceDatabase: false,
    recipients: async (ids: number[]) => rows.filter((row) => ids.includes(row.id)),
    outcomes,
    saveOutcome: async (email: string, outcome: RecipientOutcome) => { outcomes[email.toLowerCase()] = outcome; },
    sendOne: async (person) => {
      calls.push(person.email);
      if (person.email.startsWith("riley")) return { ok: false, error: "mailbox refused" };
      return { ok: true };
    },
  };
  return { io, outcomes, calls };
}

function snapshot(kind: string, extra: { subject?: string; design?: string; body?: string; attachments?: string[] } = {}) {
  return {
    kind,
    recipients: people.map((row) => ({ name: row.full_name, email: row.email })),
    subject: extra.subject || "Test Newsletter",
    design: extra.design || "pine",
    body: extra.body || JSON.stringify(articles),
    attachments: extra.attachments || ["hash-a"],
  };
}

describe("handler calls with disposable fixtures and stub providers", () => {
  it("sendProposedNewsletter invalidates a changed attachment, body, or recipient and retries one address at a time", async () => {
    const approved = snapshot("newsletter");
    const base = { title: "Test Newsletter", design: "pine", articles, contactIds: [1, 2], approvedSnapshot: approved, attachmentHash: "hash-a" };
    const changedFile = deliveryIo();
    const file = delivered(await sendProposedNewsletter({ payload: { ...base, attachmentHash: "hash-b" } }, changedFile.io));
    assert.equal(file.calls, 0);
    assert.match(file.error, /attachment|content|recipients/i);
    const changedBody = deliveryIo();
    const body = delivered(await sendProposedNewsletter({ payload: { ...base, articles: [{ title: "Changed", body: "No." }] } }, changedBody.io));
    assert.equal(body.calls, 0);
    const changedPeople = deliveryIo([{ ...people[0], email: "casey.changed@example.invalid" }]);
    const person = delivered(await sendProposedNewsletter({ payload: { ...base, contactIds: [1] } }, changedPeople.io));
    assert.equal(person.calls, 0);
    const live = deliveryIo();
    const first = delivered(await sendProposedNewsletter({ payload: base }, live.io));
    assert.deepEqual(first.sent, ["casey.sample@example.invalid"]);
    assert.equal(first.failed[0].email, "riley.sample@example.invalid");
    assert.deepEqual(live.calls, ["casey.sample@example.invalid", "riley.sample@example.invalid"]);
    const second = delivered(await sendProposedNewsletter({ payload: base }, live.io));
    assert.deepEqual(live.calls, ["casey.sample@example.invalid", "riley.sample@example.invalid", "riley.sample@example.invalid"]);
    assert.deepEqual(second.skipped, ["casey.sample@example.invalid"]);
    live.io.sendOne = async () => { live.calls.push("unknown"); return { ok: false, unknown: true }; };
    live.outcomes["riley.sample@example.invalid"] = "failed";
    await sendProposedNewsletter({ payload: base }, live.io);
    const unknownCalls = live.calls.length;
    const third = delivered(await sendProposedNewsletter({ payload: base }, live.io));
    assert.equal(live.calls.length, unknownCalls);
    assert.deepEqual(third.unknown, ["riley.sample@example.invalid"]);
  });

  it("sendQueuedCard and sendQueuedEletter use the same per-recipient record", async () => {
    const cardIo = deliveryIo();
    const cardSnapshot = snapshot("card", { subject: "Thank You", design: "Thank You", body: "Dear Casey", attachments: ["card.png"] });
    const blocked = delivered(await sendQueuedCard({
      payload: { title: "Thank You", message: "Changed", image: "card.png", contactIds: [1, 2], approvedSnapshot: cardSnapshot },
    }, cardIo.io));
    assert.equal(blocked.calls, 0);
    const letterIo = deliveryIo();
    const letterSnapshot = snapshot("letter", { subject: "Practice Follow-Up", design: "plum", body: "Dear Riley. The saved paragraph stays.", attachments: [] });
    const letter = delivered(await sendQueuedEletter({
      payload: { title: "Practice Follow-Up", design: "plum", body: "Dear Riley. The saved paragraph stays.", contactIds: [1, 2], approvedSnapshot: letterSnapshot },
    }, letterIo.io));
    assert.deepEqual(letter.sent, ["casey.sample@example.invalid"]);
    assert.equal(letter.failed[0].email, "riley.sample@example.invalid");
    const isolated = deliveryIo();
    isolated.io.isolated = true;
    isolated.io.sendOne = async () => { throw new Error("provider"); };
    const held = delivered(await sendQueuedEletter({
      payload: { title: "Practice Follow-Up", design: "plum", body: "Dear Riley. The saved paragraph stays.", contactIds: [1, 2], approvedSnapshot: letterSnapshot },
    }, isolated.io));
    assert.equal(held.calls, 0);
    assert.match(held.error, /isolated test copy/i);
  });

  it("runQueuedCampaign can record each recipient and still does not start the saved campaign", async () => {
    const io = deliveryIo();
    io.io.allowStart = true;
    io.io.sendOne = async (person) => { io.calls.push(person.email); return { ok: person.email.startsWith("casey") }; };
    const approved = snapshot("campaign", { subject: "Acceptance — Welcome Drip", design: "plum", body: JSON.stringify([{ title: "Welcome" }]), attachments: ["7"] });
    const raw = await runQueuedCampaign({
      payload: { name: "Acceptance — Welcome Drip", design: "plum", steps: [{ title: "Welcome" }], everyDays: 7, contactIds: [1, 2], approvedSnapshot: approved },
    }, io.io);
    assert.equal(raw.practiceCampaignStarted, false);
    assert.equal(raw.started, false);
    const result = delivered(raw);
    assert.deepEqual(result.sent, ["casey.sample@example.invalid"]);
    assert.equal(io.calls.length, 2);
    const again = delivered(await runQueuedCampaign({
      payload: { name: "Acceptance — Welcome Drip", design: "plum", steps: [{ title: "Welcome" }], everyDays: 7, contactIds: [1, 2], approvedSnapshot: approved },
    }, io.io));
    assert.deepEqual(again.skipped, ["casey.sample@example.invalid"]);
    assert.equal(io.calls.length, 3);
  });

  it("holdCampaign persists unsubscribe on the disposable contact, then sendDripStep excludes that person", async () => {
    const store = {
      practiceDatabase: false as const,
      campaigns: [{ id: 41, name: "Acceptance — Welcome Drip", steps: JSON.stringify([{ title: "Welcome", body: "Hello" }]), active: false }],
      contacts: [
        { id: 1, full_name: "Casey Sample", email: "casey.sample@example.invalid", tags: "Life Insurance Client" },
        { id: 2, full_name: "Riley Sample", email: "riley.sample@example.invalid", tags: "Life Insurance Client" },
        { id: 3, full_name: "Quinn Sample", email: "quinn.sample@example.invalid", tags: "Life Insurance Client" },
      ],
    };
    const command = "Unsubscribe Quinn Sample from the Acceptance — Welcome Drip. Do not send.";
    const unsubscribed = await holdCampaign(command, store);
    assert.equal(unsubscribed.started, false);
    assert.equal(unsubscribed.deleted, false);
    assert.deepEqual(unsubscribed.changedContactIds, [3]);
    assert.match(store.contacts[2].tags, /Unsubscribed/);
    assert.equal(store.contacts[0].tags, "Life Insurance Client");
    assert.equal(store.contacts[1].tags, "Life Insurance Client");
    assert.equal(store.campaigns[0].id, 41);
    const calls: string[] = [];
    const outcomes: Record<string, RecipientOutcome> = {};
    const step = await sendDripStep({
      name: "Acceptance — Welcome Drip",
      steps: store.campaigns[0].steps,
      contact_ids: "[1,2,3]",
    }, 0, {
      isolated: false,
      contacts: store.contacts,
      outcomes,
      saveOutcome: async (email, outcome) => { outcomes[email.toLowerCase()] = outcome; },
      send: async (contact) => { calls.push(contact.full_name); return { ok: true }; },
    });
    assert.deepEqual(calls, ["Casey Sample", "Riley Sample"]);
    assert.equal((step.blocked || []).includes("Quinn Sample"), true);
    const paused = await holdCampaign("Pause the Acceptance — Welcome Drip. Do not send.", store);
    assert.equal(paused.started, false);
    assert.equal(store.campaigns[0].active, false);
    const resumed = await holdCampaign("Resume the Acceptance — Welcome Drip.", store);
    assert.equal(resumed.started, false);
    assert.match(resumed.reply, /did not start/i);
    const cancelled = await holdCampaign("Cancel the Acceptance — Welcome Drip. Do not send or delete it.", store);
    assert.equal(cancelled.deleted, false);
    assert.equal(store.campaigns.length, 1);
    assert.equal(store.campaigns[0].id, 41);
  });

  it("checkDocumentReplies stores one disposable notice and ignores the same reply", async () => {
    const seen: string[] = [];
    const messages = [
      { id: "sent-1", conversationId: "thread-1", from: "desk@example.invalid" },
      { id: "reply-1", conversationId: "thread-1", from: "reviewer@example.invalid" },
    ];
    const first = await checkDocumentReplies({
      isolated: false, conversationId: "thread-1", sentMessageId: "sent-1", sender: "desk@example.invalid", seenIds: seen, messages,
      remember: async (notice) => { if (seen.includes(notice.messageId)) return false; seen.push(notice.messageId); return true; },
    });
    assert.equal(first.stored, 1);
    assert.equal(first.providerCalled, false);
    const second = await checkDocumentReplies({
      isolated: false, conversationId: "thread-1", sentMessageId: "sent-1", sender: "desk@example.invalid", seenIds: seen, messages,
      remember: async () => { throw new Error("provider"); },
    });
    assert.equal(second.stored, 0);
    const blocked = await checkDocumentReplies({
      isolated: true, conversationId: "thread-1", sentMessageId: "sent-1", sender: "desk@example.invalid", seenIds: seen, messages,
      remember: async () => { throw new Error("provider"); },
    });
    assert.equal(blocked.providerCalled, false);
  });

  it("placePending keeps one meeting when the invitation fails, and accepts Vancouver only when that is the configured zone", async () => {
    const bookings: Array<BookingRecord | undefined> = [];
    let creates = 0;
    let invites = 0;
    const pending = { local_start: "2026-12-02T11:15:00", minutes: 45, time_zone: "America/Toronto", label: "Training Room" };
    const io: Parameters<typeof placePending>[1] = {
      isolated: false,
      officeZone: "America/Toronto",
      loadEvents: async () => [],
      findBooking: async () => bookings[0] || null,
      createMeeting: async () => { creates += 1; return { ok: true, id: "zoom-1", join: "https://zoom.example/1" }; },
      sendInvitation: async () => { invites += 1; return { ok: false, error: "mailbox refused" }; },
      saveBooking: async (booking) => { bookings[0] = { ...booking }; },
    };
    const first = await placePending(pending, io);
    assert.equal(first.created, true);
    assert.equal(first.invitation, "failed");
    assert.match(first.reason || "", /will not create a second meeting|did not create another|No second meeting/i);
    const second = await placePending(pending, io);
    assert.equal(creates, 1);
    assert.equal(second.created, false);
    assert.equal(invites, 2);
    const unknownBookings: Array<BookingRecord | undefined> = [];
    let unknownCreates = 0;
    let unknownInvites = 0;
    const unknownIo: Parameters<typeof placePending>[1] = {
      isolated: false,
      officeZone: "America/Toronto",
      loadEvents: async () => [],
      findBooking: async () => unknownBookings[0] || null,
      createMeeting: async () => { unknownCreates += 1; return { ok: true, id: "zoom-2", join: "https://zoom.example/2" }; },
      sendInvitation: async () => { unknownInvites += 1; return { ok: false, unknown: true }; },
      saveBooking: async (booking) => { unknownBookings[0] = { ...booking }; },
    };
    await placePending(pending, unknownIo);
    await placePending(pending, unknownIo);
    assert.equal(unknownCreates, 1);
    assert.equal(unknownInvites, 1);
    const mismatch = await placePending({ ...pending, time_zone: "America/Vancouver" }, { ...io, findBooking: async () => null, createMeeting: async () => { creates += 1; return { ok: true, id: "no" }; } });
    assert.equal(mismatch.providerCreates, 0);
    assert.match(mismatch.reason || "", /configured zone America\/Toronto/);
    assert.match(mismatch.reason || "", /not rejected on its own/);
    assert.match(mismatch.hoursSource || "", /fixed default/);
    const vancouver = await placePending(
      { ...pending, time_zone: "America/Vancouver" },
      { ...io, officeZone: "America/Vancouver", findBooking: async () => null, createMeeting: async () => ({ ok: true, id: "zoom-van", join: "https://zoom.example/van" }), sendInvitation: async () => ({ ok: true }), saveBooking: async () => {} },
    );
    assert.equal(vancouver.ok, true);
    assert.equal(vancouver.bookingId, "zoom-van");
    let looks = 0;
    const secondLook = await placePending(pending, {
      ...io,
      findBooking: async () => null,
      loadEvents: async (): Promise<BusySlot[]> => {
        looks += 1;
        return looks < 2 ? [] : [{ start: "2026-12-02T11:20:00", end: "2026-12-02T12:00:00", title: "Training overlap" }];
      },
      createMeeting: async () => { throw new Error("provider"); },
    });
    assert.equal(secondLook.providerCreates, 0);
    assert.match(secondLook.reason || "", /second check/i);
    const early = await placePending({ ...pending, local_start: "2026-12-02T08:00:00" }, { ...io, findBooking: async () => null });
    assert.match(early.reason || "", /working hours/i);
    assert.match(early.hoursSource || "", /not a saved advisor setting/);
    assert.match(early.reason || "", /working hours/i);
    assert.match(early.hoursSource || "", /not a saved advisor setting/);
  });

  it("cancelPendingDesk, used by the desk cancel path, keeps every saved row", async () => {
    const drafts: FixtureDraft[] = [
      { id: 4, status: "pending", approval_state: "pending", body: "Dear Riley. The saved paragraph stays." },
    ];
    const letters: FixtureLetter[] = [{ id: 1, body: "Five article newsletter" }, { id: 2, body: "Four article newsletter" }];
    const actions = [{ id: 8, status: "pending", kind: "newsletter-preview" }];
    const result = await cancelPendingDesk({
      listDrafts: async () => drafts.map((row) => ({ ...row })),
      listLetters: async () => letters.map((row) => ({ ...row })),
      writeDraft: async (row) => {
        const found = drafts.find((item) => item.id === row.id);
        if (found) Object.assign(found, row);
      },
      listActions: async () => actions.map((row) => ({ ...row })),
      writeAction: async (row) => {
        const found = actions.find((item) => item.id === row.id);
        if (found) Object.assign(found, row);
      },
    });
    assert.equal(result.ok, true);
    assert.equal(drafts[0].status, "unsent");
    assert.equal(drafts[0].approval_state, "withdrawn");
    assert.equal(drafts[0].body, "Dear Riley. The saved paragraph stays.");
    assert.equal(letters.length, 2);
    assert.equal(letters[1].body, "Four article newsletter");
    assert.equal(actions[0].status, "discarded");
  });
});
