import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCardAsk, namedPreviewRecipient, namedPreviewRecipients, taskKind } from "./advisor-intent.ts";
import {
  archiveSearchReply,
  archiveSearchTerm,
  asksArchiveSearch,
  asksCampaignControl,
  asksContactRecord,
  asksEmailThreadStatus,
  asksIssueDates,
  campaignControlVerb,
  campaignStatusReply,
  emailThreadStatusReply,
  issueDateReply,
  matchingNewsletterCopies,
  missingEmailNote,
  parseIssuedDate,
  partitionAudience,
  requestedIssueYears,
} from "./delivery-audience.ts";
import { fictionalClients } from "./desk-workflows.ts";
import { orchestrationControl } from "./orchestration.ts";
import { prepareDeskCommand } from "./voice-desk.ts";
import { contentHoldKind, deliveryRequested } from "./workspace-policy.ts";

const LIFE = [
  { name: "Casey Sample", email: "casey.sample@example.invalid", tags: "Acceptance, Life Insurance Client" },
  { name: "Riley Sample", email: "riley.sample@example.invalid", tags: "Acceptance, Life Insurance Client" },
  { name: "Quinn Sample", email: "quinn.sample@example.invalid", tags: "Acceptance, Unsubscribed, Life Insurance Client" },
  { name: "Avery Sample", email: "", tags: "Acceptance, Life Insurance Client" },
  { name: "Jordan Example", email: "jordan.example@example.invalid", tags: "Acceptance, Dropbox fictional, Life Insurance Client" },
  { name: "Morgan Sample", email: "morgan.sample@example.invalid", tags: "Acceptance, TFSA Client" },
];

describe("explicit constraints beat broad fixtures", () => {
  const pause = [
    "Pause Acceptance — Welcome Drip. Do not start it or send anything. Tell me its actual saved status.",
    "Put the Acceptance — Welcome Drip on hold and tell me whether it is actually active. Do not launch it.",
  ];
  for (const line of pause) {
    it(`routes campaign control, not a contact: ${line.slice(0, 42)}`, () => {
      assert.equal(asksCampaignControl(line), true);
      assert.equal(isCardAsk(line), false);
      assert.equal(contentHoldKind(line), "campaign");
      assert.equal(taskKind(line), "campaign");
      assert.equal(deliveryRequested(line), false);
      assert.equal(campaignControlVerb(line), "pause");
    });
  }

  it("reports an inactive campaign honestly", () => {
    assert.match(campaignStatusReply("Acceptance — Welcome Drip", false, "pause"), /not active/);
    assert.match(campaignStatusReply("Acceptance — Welcome Drip", false, "pause"), /did not start/i);
    assert.doesNotMatch(campaignStatusReply("Acceptance — Welcome Drip", false, "status"), /which contact/i);
  });

  const dates = [
    "List the fictional clients whose life insurance policy was issued more than five years ago. Use saved issue dates only, and identify missing dates. Do not send anything.",
    "Which fictional life-insurance policies were issued over 5 years ago? Use saved dates only and name missing dates. Do not send.",
  ];
  for (const line of dates) {
    it(`filters by issue date instead of mail eligibility: ${line.slice(0, 36)}`, () => {
      assert.equal(asksIssueDates(line), true);
      assert.equal(contentHoldKind(line), "issue-dates");
      assert.equal(taskKind(line), "issue-dates");
      assert.equal(requestedIssueYears(line), 5);
    });
  }

  it("uses only saved issue dates and names the gaps", () => {
    const files = fictionalClients("34").filter((file) => file.advisorId === "34" && /profile\.txt$/i.test(file.name));
    const records = files.map((file) => ({
      name: file.text.match(/\bName:\s*(.+)/i)?.[1]?.trim() || file.clientId,
      source: file.path,
      issued: parseIssuedDate(file.text),
    }));
    records.push({ name: "Casey Sample", source: "Unique Advisor contacts table — no issue-date column is saved", issued: "" });
    const reply = issueDateReply(records, 5, new Date("2026-11-19T12:00:00Z"));
    assert.match(reply, /Alex Example: issued 2019-04-12/);
    assert.match(reply, /Sam Example: no issue date is saved/);
    assert.match(reply, /Casey Sample: no issue date is saved/);
    assert.match(reply, /not a mail-eligibility list/);
    assert.doesNotMatch(reply, /can receive/);
  });

  const casey = [
    "Use the Unique Advisor database only. Show the saved contact details for Casey Sample and where those details came from. Do not use Dropbox or change anything.",
    "What does the Unique Advisor database have saved for Casey Sample, and what is the source? Do not open Dropbox.",
  ];
  for (const line of casey) {
    it(`asks for one saved contact, not the whole list: ${line.slice(0, 36)}`, () => {
      assert.equal(asksContactRecord(line), true);
      assert.equal(contentHoldKind(line), "contact-record");
      assert.notEqual(contentHoldKind(line), "contacts");
    });
  }

  it("keeps a life-insurance eligibility question on the contact list", () => {
    const line = "Who can receive mail among life insurance clients? Do not send.";
    assert.equal(contentHoldKind(line), "contacts");
    assert.equal(taskKind(line), "contacts");
    const split = partitionAudience(LIFE.filter((row) => row.tags.includes("Life Insurance Client")));
    assert.deepEqual(split.eligible.map((row) => row.name), ["Casey Sample", "Riley Sample", "Jordan Example"]);
    assert.equal(split.excluded.length, 2);
    assert.match(split.excluded.map((row) => `${row.name}: ${row.reason}`).join("\n"), /Quinn Sample: Unsubscribed/);
    assert.match(split.excluded.map((row) => `${row.name}: ${row.reason}`).join("\n"), /Avery Sample: No email is recorded/);
  });

  it("previews every named card recipient and explains a missing email", () => {
    const both = "Preview the Thank You card for Casey Sample and Riley Sample only. Show both personalized previews and both recipient emails. Do not send.";
    const avery = "Preview the Thank You card for Avery Sample only. Show the recipient email or explain if it is missing. Do not send.";
    const paraphrased = "Show the thank you card preview for Avery Sample and say whether the email is missing. Don't send it.";
    assert.deepEqual(namedPreviewRecipients(both), ["Casey Sample", "Riley Sample"]);
    assert.equal(namedPreviewRecipient(both), "Casey Sample");
    assert.equal(contentHoldKind(both), "e-card");
    assert.equal(deliveryRequested(both), false);
    assert.deepEqual(namedPreviewRecipients(avery), ["Avery Sample"]);
    assert.deepEqual(namedPreviewRecipients(paraphrased), ["Avery Sample"]);
    assert.match(missingEmailNote("Avery Sample"), /no email saved/i);
  });

  const threads = [
    "Show the status of the existing Signature Workflow Test email thread and whether replies can be checked in this isolated test copy. Do not send any email or contact Microsoft.",
    "What is the status of the Signature Workflow Test mail thread, and can this isolated copy check replies? Do not email anyone.",
  ];
  for (const line of threads) {
    it(`routes email-thread status away from a signature preview: ${line.slice(0, 32)}`, () => {
      assert.equal(asksEmailThreadStatus(line), true);
      assert.equal(contentHoldKind(line), "email-thread");
      assert.notEqual(contentHoldKind(line), "signature");
      assert.equal(deliveryRequested(line), false);
    });
  }

  it("describes the saved thread without substituting TEST ONLY", () => {
    const reply = emailThreadStatusReply({
      subject: "Signature Workflow Test — fictional document",
      recipient: "masoudz@outlook.com",
      isolated: true,
      stored: false,
      conversationKnown: false,
    });
    assert.match(reply, /Signature Workflow Test/);
    assert.match(reply, /masoudz@outlook.com/);
    assert.match(reply, /cannot check replies/i);
    assert.match(reply, /Microsoft is not contacted/i);
    assert.doesNotMatch(reply, /TEST ONLY/);
    assert.doesNotMatch(reply, /Dropbox Sign test mode/);
  });

  const archive = [
    "Search the saved newsletter archive for Time Value of Money. List matching saved copies and their IDs. Do not create, edit or send anything.",
    "Look through the saved newsletter copies for Time Value of Money and list their ids. Do not create or send.",
  ];
  for (const line of archive) {
    it(`searches the archive instead of asking which newsletter to open: ${line.slice(0, 32)}`, () => {
      assert.equal(asksArchiveSearch(line), true);
      assert.equal(contentHoldKind(line), "archive");
      assert.notEqual(taskKind(line), "newsletter");
      assert.equal(orchestrationControl(line).desk, true);
    });
  }

  it("lists every saved copy whose article matches, including Of and of", () => {
    const term = archiveSearchTerm("Search the saved newsletter archive for Time Value of Money. List matching saved copies and their IDs.");
    assert.equal(term, "Time Value of Money");
    const hits = matchingNewsletterCopies([
      { id: 1, title: "Test Newsletter", articles: [{ title: "Time Value Of Money" }, { title: "Life Insurance" }] },
      { id: 2, title: "Test Newsletter", articles: [{ title: "Time Value of Money" }] },
      { id: 9, title: "Other", articles: [{ title: "Retirement Planning" }] },
    ], term);
    assert.deepEqual(hits.map((hit) => hit.id), [1, 2]);
    const reply = archiveSearchReply(term, hits);
    assert.match(reply, /#1/);
    assert.match(reply, /#2/);
    assert.doesNotMatch(reply, /Which newsletter should I open/);
  });

  it("clears a Persian cancellation the same way as Cancel, and keeps drafts when asked", () => {
    const mapped = prepareDeskCommand("لغو کن. چیزی ارسال نکن. پیش‌نویس‌ها را نگه دار.");
    assert.match(mapped, /Cancel the pending approval/);
    assert.match(mapped, /Keep the drafts/);
    const control = orchestrationControl(mapped);
    assert.equal(control.cancelStaged, true);
    assert.equal(control.keepDrafts, true);
    assert.equal(control.conversational, false);
    assert.equal(orchestrationControl("Cancel.").cancelStaged, true);
    assert.equal(orchestrationControl("Cancel.").keepDrafts, false);
  });

  it("does not let document, calendar, email, or schedule words swallow edits, follow-ups, inbox, or onboarding", () => {
    const edit = "Swap the third point for the document follow-up. Show only the updated list. Do not search or send.";
    assert.equal(contentHoldKind(edit), "");
    assert.equal(orchestrationControl(edit).conversational, true);
    assert.equal(orchestrationControl(edit).desk, false);

    const noLookup = "Don't look up the calendar or the contacts. Stay with what is already in this conversation.";
    assert.equal(contentHoldKind(noLookup), "");
    assert.equal(orchestrationControl(noLookup).conversational, true);
    assert.equal(orchestrationControl(noLookup).blockLookups, true);

    const follow = "Which person is that appointment for?";
    assert.notEqual(contentHoldKind(follow), "calendar");
    assert.equal(orchestrationControl(follow).conversational, true);
    assert.equal(orchestrationControl(follow).desk, false);

    assert.equal(taskKind("Read my emails"), "inbox");
    assert.equal(taskKind("Check the inbox for new mail"), "inbox");
    assert.notEqual(contentHoldKind("Read my emails"), "email");

    const onboard = "Demonstrate onboarding for fictional client Sam Example. Draft an intake checklist with placeholders. Do not search, save, send, or schedule.";
    assert.equal(taskKind(onboard), "onboarding");
    assert.equal(contentHoldKind(onboard), "");
    assert.equal(taskKind("Do not send this for signature"), "");
    assert.equal(contentHoldKind("Preview the signature request. Do not send."), "signature");
    assert.equal(contentHoldKind("Show the test email preview. Do not send."), "email");
    assert.equal(contentHoldKind("Show my appointments for today. Do not book anything."), "calendar");
  });
});
