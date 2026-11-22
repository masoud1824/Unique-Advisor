import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOCUMENT_MAIL, documentMailPreview, noticesToCreate, planReplyNotices, REVIEWED_ADVISOR, REVIEWED_APPROVAL, REVIEWED_ATTACHMENT, reviewedTestDecision } from "./document-mail.ts";

const attachment = {
  path: "/Unique Advisor/Assistant Test/Signature Workflow Test.pdf",
  name: "Signature Workflow Test.pdf",
  size: 1102,
  hash: "11e40bac6227b9ef72ce123c134376fe7699af341a8331f7d0e8b7db9d9c77c5",
};

describe("document email preview", () => {
  it("shows the sender, recipient, message, and exact attachment", () => {
    const preview = documentMailPreview({ sender: "advisor@example.com", attachment });
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.match(preview.preview, /From: advisor@example\.com/);
    assert.match(preview.preview, new RegExp(DOCUMENT_MAIL.recipient));
    assert.match(preview.preview, /Subject: Signature Workflow Test/);
    assert.match(preview.preview, /fictional test email/);
    assert.match(preview.preview, new RegExp(attachment.hash));
    assert.match(preview.preview, /hosted schedule/);
    assert.match(preview.preview, /not read while outbound checks are blocked/);
    assert.equal(preview.preview.includes("test-only"), false);
  });

  it("does not invent a sender", () => {
    assert.equal(documentMailPreview({ sender: "", attachment }).ok, false);
  });

  it("records one notice per new reply in that thread only", () => {
    const first = planReplyNotices({
      conversationId: "thread-1",
      sentMessageId: "sent-1",
      sender: "advisor@example.com",
      seen: [],
      messages: [
        { id: "sent-1", conversationId: "thread-1", from: "advisor@example.com" },
        { id: "reply-1", conversationId: "thread-1", from: "reviewer@example.invalid" },
        { id: "other", conversationId: "thread-2", from: "reviewer@example.invalid" },
      ],
    });
    assert.deepEqual(first.map((item) => item.messageId), ["reply-1"]);
    const again = planReplyNotices({
      conversationId: "thread-1",
      sentMessageId: "sent-1",
      sender: "advisor@example.com",
      seen: ["reply-1"],
      messages: [
        { id: "reply-1", conversationId: "thread-1", from: "reviewer@example.invalid" },
        { id: "reply-2", conversationId: "thread-1", from: "reviewer@example.invalid" },
      ],
    });
    assert.deepEqual(again.map((item) => item.messageId), ["reply-2"]);
  });
});

describe("reply notice regression", () => {
  const thread = {
    conversationId: "thread-1",
    sentMessageId: "sent-1",
    sender: "desk@example.invalid",
  };
  const messages = [
    { id: "sent-1", conversationId: "thread-1", from: "desk@example.invalid" },
    { id: "own-followup", conversationId: "thread-1", from: "desk@example.invalid" },
    { id: "reply-1", conversationId: "thread-1", from: "reviewer@example.invalid" },
    { id: "other-thread", conversationId: "thread-2", from: "reviewer@example.invalid" },
  ];
  it("detects one reply and creates one advisor notice", () => {
    const planned = planReplyNotices({ ...thread, seen: [], messages });
    assert.deepEqual(planned.map((item) => item.messageId), ["reply-1"]);
    const created = noticesToCreate(planned, []);
    assert.equal(created.length, 1);
    assert.equal(created[0].body, "New reply in the Signature Workflow Test email thread.");
  });
  it("does not create a second reply record or notice for the same message", () => {
    const planned = planReplyNotices({ ...thread, seen: [], messages });
    const first = noticesToCreate(planned, []);
    const second = noticesToCreate(planned, first.map((item) => item.messageId));
    assert.equal(first.length, 1);
    assert.deepEqual(second, []);
    const repeated = planReplyNotices({ ...thread, seen: ["reply-1"], messages });
    assert.deepEqual(noticesToCreate(repeated, ["reply-1"]), []);
  });
});

describe("reviewed test send restriction", () => {
  const exact = {
    advisorSlug: REVIEWED_ADVISOR,
    sender: "advisor@example.com",
    to: ["reviewer@example.invalid"],
    attachment: REVIEWED_ATTACHMENT,
    approvalText: REVIEWED_APPROVAL,
    alreadySent: false,
  };
  it("permits only the reviewed advisor, recipient, and attachment version", () => {
    const allowed = reviewedTestDecision(exact);
    assert.equal(allowed.ok, true);
    if (!allowed.ok) return;
    const body = JSON.stringify(allowed.message);
    assert.equal(body.includes("ccRecipients"), false);
    assert.equal(body.includes("bccRecipients"), false);
    assert.equal(allowed.message.toRecipients.length, 1);
    assert.equal(reviewedTestDecision({ ...exact, advisorSlug: "other-advisor" }).ok, false);
    assert.equal(reviewedTestDecision({ ...exact, to: ["reviewer@example.invalid", "other@example.com"] }).ok, false);
    assert.equal(reviewedTestDecision({ ...exact, to: ["other@example.com"] }).ok, false);
    assert.equal(reviewedTestDecision({ ...exact, cc: ["other@example.com"] }).ok, false);
    assert.equal(reviewedTestDecision({ ...exact, bcc: ["other@example.com"] }).ok, false);
    assert.equal(reviewedTestDecision({ ...exact, attachment: { ...REVIEWED_ATTACHMENT, hash: "different" } }).ok, false);
    assert.equal(reviewedTestDecision({ ...exact, approvalText: "yes" }).ok, false);
    assert.equal(reviewedTestDecision({ ...exact, approvalText: "" }).ok, false);
    assert.equal(reviewedTestDecision({ ...exact, alreadySent: true }).ok, false);
  });
});