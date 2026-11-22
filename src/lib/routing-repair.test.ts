import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isClientFileAsk, isInboxAsk, namedPreviewRecipients, taskKind } from "./advisor-intent.ts";
import { personalize } from "./catalog.ts";
import {
  archiveSearchTerm,
  asksArchiveSearch,
  asksCampaignControl,
  asksContactRecord,
  asksEmailThreadStatus,
  asksSavedCampaignContent,
  asksSavedCampaignReview,
  asksStatedMeeting,
  audienceClarification,
  audienceRequest,
  civilDate,
  classifyAudience,
  clearsStalePreview,
  emailThreadStatusReply,
  explicitCampaignLifecycle,
  formatAudience,
  issueDateReply,
  LOCAL_FIXTURE_SOURCE,
  meetingDetailReply,
  meetingPreviewFacts,
  matchingNewsletterCopies,
  namedPeople,
  shouldReplacePreview,
  yearsBack,
} from "./delivery-audience.ts";
import { chooseOpenNewsletter } from "./desk-workflows.ts";
import { contentHoldKind, draftWithdrawalUpdate, deliveryRequested } from "./workspace-policy.ts";
import { prepareDeskCommand } from "./voice-desk.ts";
import { orchestrationControl } from "./orchestration.ts";

const LIFE = [
  { name: "Casey Sample", email: "casey.sample@example.invalid", tags: "Acceptance, Life Insurance Client" },
  { name: "Riley Sample", email: "riley.sample@example.invalid", tags: "Acceptance, Life Insurance Client" },
  { name: "Quinn Sample", email: "quinn.sample@example.invalid", tags: "Acceptance, Unsubscribed, Life Insurance Client" },
  { name: "Avery Sample", email: "", tags: "Acceptance, Life Insurance Client" },
  { name: "Jordan Example", email: "jordan.example@example.invalid", tags: "Acceptance, Life Insurance Client" },
  { name: "Morgan Sample", email: "morgan.sample@example.invalid", tags: "Acceptance, TFSA Client" },
];

describe("routing repair paraphrases", () => {
  const archive = [
    "Search the saved newsletter archive for Time Value of Money. List matching saved copies and their IDs. Do not create, edit or send anything.",
    "Find archived newsletters containing the article 'Time Value of Money'; give me their saved-copy numbers. Read only.",
    "Which saved newsletter copies mention Time Value of Money? List the copy numbers only. Do not open one and do not send.",
    "Look for Time Value of Money in the newsletter archive and report every matching saved copy id. Read only.",
  ];
  for (const line of archive) {
    it(`searches the archive: ${line.slice(0, 48)}`, () => {
      assert.equal(asksArchiveSearch(line), true);
      assert.equal(contentHoldKind(line), "archive");
      assert.notEqual(taskKind(line), "newsletter");
      assert.equal(clearsStalePreview(line), true);
      assert.match(archiveSearchTerm(line), /time value of money/i);
    });
  }

  const contacts = [
    "Use the Unique Advisor database only. Show the saved contact details for Casey Sample and where those details came from. Do not use Dropbox or change anything.",
    "Show me only Casey Sample's contact record from Unique Advisor, including its source. Leave Dropbox alone and make no changes.",
    "Pull Casey Sample from the Unique Advisor contact table and say where that record came from. Do not open Dropbox.",
    "I want the saved Unique Advisor file for Casey Sample only, with its source. Leave everything else untouched.",
  ];
  for (const line of contacts) {
    it(`returns only Casey: ${line.slice(0, 42)}`, () => {
      assert.deepEqual(namedPeople(line), ["Casey Sample"]);
      assert.equal(asksContactRecord(line), true);
      assert.equal(contentHoldKind(line), "contact-record");
      assert.equal(clearsStalePreview(line), true);
    });
  }

  const threads = [
    "Show the status of the existing Signature Workflow Test email thread and whether replies can be checked in this isolated test copy. Do not send any email or contact Microsoft.",
    "Look up the locally stored conversation for the email titled Signature Workflow Test. Can this isolated desk monitor its replies? Do not connect to Microsoft or send anything.",
    "What replies are stored locally for the Signature Workflow Test message? Do not contact Microsoft.",
    "Check the saved mail conversation named Signature Workflow Test and say if this isolated copy can see replies. Do not send.",
  ];
  for (const line of threads) {
    it(`keeps the mail thread off the signature preview: ${line.slice(0, 42)}`, () => {
      assert.equal(asksEmailThreadStatus(line), true);
      assert.equal(contentHoldKind(line), "email-thread");
      assert.notEqual(contentHoldKind(line), "signature");
      assert.equal(deliveryRequested(line), false);
      const reply = emailThreadStatusReply({
        subject: "Signature Workflow Test — fictional document",
        recipient: "reviewer@example.invalid",
        isolated: true,
        stored: true,
        conversationKnown: false,
      });
      assert.match(reply, /cannot check replies|Microsoft is not contacted/i);
      assert.doesNotMatch(reply, /TEST ONLY/);
      assert.doesNotMatch(reply, /not signed in/i);
    });
  }

  const meetings = [
    "Show the November 24, 2026 2:00 p.m. 30-minute meeting at Test Office. Do not book it and do not contact Outlook.",
    "Preview the in-person meeting on Nov 24, 2026 at 2pm for 30 minutes at Test Office. Do not schedule anything.",
    "Read the meeting details for 24 November 2026, 2:00 pm, 30 mins, Test Office. Do not book.",
  ];
  for (const line of meetings) {
    it(`states the meeting instead of calling Outlook: ${line.slice(0, 42)}`, () => {
      assert.equal(asksStatedMeeting(line), true);
      assert.equal(contentHoldKind(line), "meeting");
      assert.notEqual(contentHoldKind(line), "calendar");
      const facts = meetingPreviewFacts(line);
      assert.match(facts.when, /24/);
      assert.match(facts.when, /2026/);
      assert.match(facts.time, /2/);
      assert.equal(facts.minutes, "30");
      assert.equal(facts.place, "Test Office");
      const reply = meetingDetailReply(facts, true);
      assert.match(reply, /Nothing was booked/);
      assert.match(reply, /Test Office/);
      assert.match(reply, /Outlook was not contacted/);
      assert.doesNotMatch(reply, /not signed in/i);
      assert.doesNotMatch(reply, /Sign in with Microsoft/i);
    });
  }

  it("uses the Toronto date even when UTC has already rolled over", () => {
    const now = new Date("2026-11-20T00:48:00Z");
    assert.equal(civilDate(now), "2026-11-19");
    assert.equal(yearsBack(now, 5), "2021-11-19");
    const reply = issueDateReply([
      { name: "Alex Example", source: LOCAL_FIXTURE_SOURCE, issued: "2019-04-12" },
      { name: "Sam Example", source: LOCAL_FIXTURE_SOURCE, issued: "" },
      { name: "Casey Sample", source: "Unique Advisor contacts table — no issue-date column is saved. Not a Dropbox read.", issued: "" },
    ], 5, now);
    assert.match(reply, /2026-11-19/);
    assert.match(reply, /Cutoff: 2021-11-19/);
    assert.match(reply, /Alex Example: issued 2019-04-12/);
    assert.match(reply, /Sam Example: no issue date is saved/);
    assert.match(reply, /not a live Dropbox read/i);
    assert.match(reply, /not independently verified/i);
    assert.doesNotMatch(reply, /can receive/);
  });

  it("shows the life-insurance audience and the Casey/Quinn split without sending", () => {
    const newsletter = "Preview saved newsletter copy #1 for life insurance clients. Show who is included and who is excluded. Do not send.";
    assert.equal(contentHoldKind(newsletter), "newsletter");
    assert.equal(deliveryRequested(newsletter), false);
    const life = formatAudience(classifyAudience(LIFE, newsletter), "Audience");
    assert.match(life, /Casey Sample <casey\.sample@example\.invalid>/);
    assert.match(life, /Riley Sample/);
    assert.match(life, /Jordan Example/);
    assert.match(life, /Quinn Sample(?:\s*<[^>]+>)?:\s*Unsubscribed/);
    assert.match(life, /Avery Sample: No email is recorded/);
    assert.doesNotMatch(life, /Morgan Sample/);

    const drip = "Preview the Acceptance — Welcome Drip for Casey Sample and Quinn Sample. Show who is included and who is excluded. Do not start it or send anything.";
    assert.equal(contentHoldKind(drip), "campaign");
    assert.equal(deliveryRequested(drip), false);
    const split = formatAudience(classifyAudience(LIFE, drip), "Named recipients");
    assert.match(split, /Included:[\s\S]*Casey Sample/);
    assert.match(split, /Quinn Sample(?:\s*<[^>]+>)?:\s*Unsubscribed/);
    assert.doesNotMatch(split, /Riley Sample <riley/);
  });

  it("personalizes the Riley letter preview and keeps the template token out of that preview", () => {
    const line = "Preview the Acceptance — Retirement Note for Riley Sample. Show the recipient email. Do not send.";
    assert.equal(contentHoldKind(line), "e-letter");
    assert.deepEqual(namedPeople(line), ["Riley Sample"]);
    const template = "Dear [Contact Name],\n\nThe second paragraph stays.";
    const shown = `Riley Sample <riley.sample@example.invalid>\n\n${personalize(template, "Riley Sample")}`;
    assert.match(shown, /Dear Riley Sample/);
    assert.match(shown, /riley\.sample@example\.invalid/);
    assert.doesNotMatch(shown, /\[Contact Name\]/);
    assert.match(template, /\[Contact Name\]/);
    assert.equal(namedPreviewRecipients(line)[0], "Riley Sample");
  });

  it("withdraws approval without deleting a saved draft, in English or Farsi", () => {
    const withdrawal = draftWithdrawalUpdate();
    assert.equal(withdrawal.deletesRows, false);
    assert.equal(withdrawal.status, "unsent");
    assert.equal(withdrawal.approval_state, "withdrawn");
    assert.notEqual(withdrawal.status, "cancelled");
    const english = orchestrationControl("Cancel.");
    const persian = orchestrationControl(prepareDeskCommand("لغو کن. چیزی ارسال نکن. پیش‌نویس‌ها را نگه دار."));
    assert.equal(english.cancelStaged, true);
    assert.equal(persian.cancelStaged, true);
    assert.equal(persian.keepDrafts, true);
    assert.equal(withdrawal.deletesRows, false);
  });

  it("maps Farsi equivalents through the shared voice handler", () => {
    const archive = prepareDeskCommand("خبرنامه‌های بایگانی را برای 'Time Value of Money' پیدا کن. فقط بخوان.");
    assert.equal(contentHoldKind(archive), "archive");
    assert.match(archiveSearchTerm(archive), /Time Value of Money/);
    const contact = prepareDeskCommand("فقط پرونده کیسی سمپل را نشان بده. دراپ‌باکس را باز نکن.");
    assert.equal(contentHoldKind(contact), "contact-record");
    assert.deepEqual(namedPeople(contact), ["Casey Sample"]);
    const thread = prepareDeskCommand("گفتگوی ایمیل Signature Workflow Test را نشان بده و بگو پاسخ‌ها را می‌شود دید یا نه. مایکروسافت را وصل نکن.");
    assert.equal(contentHoldKind(thread), "email-thread");
    const dates = prepareDeskCommand("کدام بیمه‌های عمر بیش از پنج سال پیش صادر شده‌اند؟ فقط تاریخ ذخیره‌شده.");
    assert.equal(contentHoldKind(dates), "issue-dates");
    const meeting = prepareDeskCommand("جلسه ۲۴ نوامبر را نشان بده. وقت نگیر.");
    assert.equal(contentHoldKind(meeting), "meeting");
    const letter = prepareDeskCommand("نامه بازنشستگی رایلی را پیش‌نمایش کن. نفرست.");
    assert.equal(contentHoldKind(letter), "e-letter");
    assert.deepEqual(namedPeople(letter), ["Riley Sample"]);
    const drip = prepareDeskCommand("کمپین کیسی و کوین را نشان بده ولی شروع نکن.");
    assert.equal(contentHoldKind(drip), "campaign");
  });
});

describe("saved records, not invented text", () => {
  const walk = "Walk me through Acceptance — Welcome Drip for Casey Sample and Quinn Sample: show every message, the waits and who would be excluded. This is review only, not permission to enroll or start anyone.";
  const walks = [
    walk,
    "Take me through the saved Acceptance — Welcome Drip. Read the stored messages and waits only. Do not enroll anyone.",
    "Explain the Welcome Drip step by step, including who is left out. Don't start it.",
  ];
  for (const line of walks) {
    it(`reads the saved drip: ${line.slice(0, 42)}`, () => {
      assert.equal(deliveryRequested(line), false);
      assert.equal(contentHoldKind(line), "campaign");
      assert.equal(taskKind(line), "campaign");
      assert.equal(orchestrationControl(line).conversational, false);
      assert.equal(shouldReplacePreview(line), true);
    });
  }

  const issues = "Which saved issues include a piece on the time value of money? Give their IDs without changing them.";
  const searches = [
    issues,
    "Which saved newsletters contain an article about the time value of money? IDs only. Do not edit them.",
    "Find saved issues whose article text mentions time value of money and list the copy numbers. Read only.",
  ];
  for (const line of searches) {
    it(`searches article text: ${line.slice(0, 42)}`, () => {
      assert.equal(asksArchiveSearch(line), true);
      assert.equal(contentHoldKind(line), "archive");
      assert.match(archiveSearchTerm(line), /time value of money/i);
      assert.equal(shouldReplacePreview(line), true);
    });
  }
  const copies = [
    { id: 1, title: "Test Newsletter", articles: [{ title: "Life Insurance", body: "The time value of money is the cost of waiting." }] },
    { id: 2, title: "Test Newsletter", articles: [{ title: "Time Value of Money", body: "Saved." }] },
    { id: 3, title: "Other Notes", articles: [{ title: "Office Hours", body: "Nothing about money timing." }] },
  ];
  const hits = matchingNewsletterCopies(copies, archiveSearchTerm(issues));
  assert.deepEqual(hits.map((hit) => hit.id), [1, 2]);

  const casey = "Without changing anything, show Casey Sample alone from Unique Advisor contacts, including email and tags. Do not look in Dropbox.";
  const lookups = [
    casey,
    "Show only Casey Sample in the Unique Advisor contacts, with email and tags. Leave Dropbox alone.",
    "Read Casey Sample from the contacts list and include the email and tags. Do not change the record.",
  ];
  for (const line of lookups) {
    it(`shows the contact, not the inbox: ${line.slice(0, 42)}`, () => {
      assert.equal(asksContactRecord(line), true);
      assert.equal(isInboxAsk(line), false);
      assert.equal(contentHoldKind(line), "contact-record");
      assert.equal(taskKind(line), "contact-record");
      assert.equal(shouldReplacePreview(line), true);
      assert.equal(orchestrationControl(line).conversational, false);
    });
  }

  it("maps a Farsi drip walkthrough onto the saved campaign", () => {
    const mapped = prepareDeskCommand("مرا از Acceptance — Welcome Drip برای Casey Sample و Quinn Sample رد کن. فقط مرور. شروع نکن.");
    assert.equal(contentHoldKind(mapped), "campaign");
    assert.equal(asksSavedCampaignReview(mapped), true);
    assert.match(mapped, /Do not start/i);
  });

  const constrained = [
    "Before considering enrollment, let me inspect the actual saved messages and delays in Acceptance — Welcome Drip for Riley Sample and Avery Sample. Identify anyone who cannot receive it. Leave it inactive and make no changes.",
    "Show me the saved steps and the delay between them in the Welcome Drip for Riley Sample and Avery Sample. Say who cannot receive it. Keep it switched off and change nothing.",
    "I want a read-only look at the stored Welcome Drip messages and waits for Riley Sample. Point out who cannot receive it. It has to stay inactive.",
  ];
  for (const line of constrained) {
    it(`reviews the drip despite a keep-inactive constraint: ${line.slice(0, 42)}`, () => {
      assert.equal(asksSavedCampaignContent(line), true);
      assert.equal(explicitCampaignLifecycle(line), false);
      assert.equal(asksSavedCampaignReview(line), true);
      assert.equal(asksCampaignControl(line), false);
      assert.equal(contentHoldKind(line), "campaign");
      assert.equal(deliveryRequested(line), false);
      assert.equal(audienceRequest(line), "people");
      assert.equal(shouldReplacePreview(line), true);
      assert.equal(orchestrationControl(line).conversational, false);
    });
  }

  const lifecycle = [
    "Pause Acceptance — Welcome Drip. Do not start it or send anything. Tell me its actual saved status.",
    "Put the Acceptance — Welcome Drip on hold and tell me whether it is actually active. Do not launch it.",
    "Cancel the Acceptance — Welcome Drip. Do not send.",
    "Is the Welcome Drip inactive? Do not start it.",
    "Unsubscribe Quinn Sample from the Welcome Drip. Do not send.",
  ];
  for (const line of lifecycle) {
    it(`keeps a real campaign control: ${line.slice(0, 42)}`, () => {
      assert.equal(asksSavedCampaignReview(line), false);
      assert.equal(asksCampaignControl(line), true);
      assert.equal(contentHoldKind(line), "campaign");
      assert.equal(deliveryRequested(line), false);
    });
  }

  it("maps a Farsi review-plus-inactive request onto the saved drip, and a pause stays a pause", () => {
    const review = prepareDeskCommand("قبل از ثبت‌نام، پیام‌ها و تأخیرهای ذخیره‌شده Acceptance — Welcome Drip را برای رایلی و اوری نشان بده. غیرفعال بماند و تغییری نده.");
    assert.equal(asksSavedCampaignReview(review), true);
    assert.equal(asksCampaignControl(review), false);
    assert.match(review, /Riley Sample/);
    assert.match(review, /Avery Sample/);
    assert.equal(audienceRequest(review), "people");
    const pause = prepareDeskCommand("کمپین خوشامد را متوقف کن و شروع نکن.");
    assert.equal(asksCampaignControl(pause), true);
    assert.equal(asksSavedCampaignReview(pause), false);
  });
});

describe("held-out wording for rehearsal, sketched meetings, and typed Farsi records", () => {
  const copies = [
    { id: 1, title: "Test Newsletter", articles: [{ title: "Time Value Of Money", body: "One." }] },
    { id: 2, title: "Test Newsletter", articles: [{ title: "Time Value of Money", body: "Two." }] },
  ];
  const rehearsals = [
    "Show what newsletter number 1 would look like for my life-insurance group, and tell me who would be left out. This is a rehearsal only; do not deliver it.",
    "Rehearse issue no. 1 for the life insurance audience and list who is ineligible. Don't deliver it.",
    "What would copy number 1 look like for life-insurance clients, including people left off the list? Do not send.",
  ];
  for (const line of rehearsals) {
    it(`keeps the copy and the life-insurance audience: ${line.slice(0, 42)}`, () => {
      assert.equal(deliveryRequested(line), false);
      assert.equal(contentHoldKind(line), "newsletter");
      assert.equal(chooseOpenNewsletter(copies, line)?.id, 1);
      assert.equal(audienceRequest(line), "group");
      const life = formatAudience(classifyAudience(LIFE, line), "Audience");
      assert.match(life, /Casey Sample <casey\.sample@example\.invalid>/);
      assert.match(life, /Quinn Sample(?:\s*<[^>]+>)?:\s*Unsubscribed/);
      assert.match(life, /Avery Sample: No email is recorded/);
      assert.doesNotMatch(life, /Morgan Sample/);
    });
  }

  it("asks which group when a rehearsal names nobody", () => {
    const line = "Show newsletter number 2 and tell me who would be left out. Do not send.";
    assert.equal(chooseOpenNewsletter(copies, line)?.id, 2);
    assert.equal(audienceRequest(line), "ask");
    assert.match(audienceClarification(), /did not guess an audience/i);
    assert.equal(contentHoldKind(line), "newsletter");
  });

  const sketches = [
    "Sketch a half-hour face-to-face appointment with Riley Sample at Practice Room on November 25, 2026, starting at 10:30 am Toronto time. Just show the proposed details; no calendar access, booking or invitations.",
    "Outline a 45-minute in-person visit with Jordan Example in the Board Room on 3 December 2026 at 9am Toronto. Proposed details only; no booking and no invitations.",
  ];
  for (const line of sketches) {
    it(`shows the sketched meeting instead of the calendar block: ${line.slice(0, 36)}`, () => {
      assert.equal(asksStatedMeeting(line), true);
      assert.equal(contentHoldKind(line), "meeting");
      assert.notEqual(contentHoldKind(line), "calendar");
      assert.equal(deliveryRequested(line), false);
      const facts = meetingPreviewFacts(line);
      const reply = meetingDetailReply(facts, true);
      assert.match(reply, /Nothing was booked/);
      assert.match(reply, /Outlook was not contacted/);
      assert.doesNotMatch(reply, /not signed in|Sign in with Microsoft|isolated test copy did not contact Outlook/i);
      if (/Riley Sample/.test(line)) {
        assert.equal(facts.person, "Riley Sample");
        assert.equal(facts.place, "Practice Room");
        assert.equal(facts.minutes, "30");
        assert.match(facts.when, /November 25/);
        assert.match(facts.time, /10:30/);
        assert.equal(facts.zone, "America/Toronto");
        assert.match(reply, /face-to-face/);
      } else {
        assert.equal(facts.person, "Jordan Example");
        assert.equal(facts.place, "Board Room");
        assert.equal(facts.minutes, "45");
        assert.match(facts.when, /3 December 2026/);
        assert.match(facts.time, /9/);
      }
    });
  }

  it("asks for a meeting detail it could not read instead of dropping the rest", () => {
    const line = "Sketch a face-to-face appointment with Avery Sample. Proposed details only; no calendar access.";
    assert.equal(asksStatedMeeting(line), true);
    const reply = meetingDetailReply(meetingPreviewFacts(line), true);
    assert.match(reply, /With: Avery Sample\n/);
    assert.match(reply, /Still needed/);
    assert.match(reply, /the date/);
    assert.doesNotMatch(reply, /not signed in/i);
  });

  const farsiContacts = [
    "فقط اطلاعات ذخیره‌شده Casey Sample را از پایگاه داده Unique Advisor نشان بده. به Dropbox دست نزن و چیزی را تغییر نده.",
    "اطلاعات ذخیره‌شده کیسی را از پایگاه Unique Advisor بخوان. Dropbox را باز نکن و چیزی را عوض نکن.",
    "رایلی را از پایگاه داده نشان بده. به دراپ‌باکس دست نزن.",
  ];
  for (const line of farsiContacts) {
    it(`routes typed Farsi to the contact table, not Dropbox: ${line.slice(0, 24)}`, () => {
      const mapped = prepareDeskCommand(line);
      assert.equal(contentHoldKind(mapped), "contact-record");
      assert.equal(isClientFileAsk(mapped), false);
      assert.equal(clearsStalePreview(mapped), true);
      assert.doesNotMatch(mapped, /fictional|Assistant Test/i);
      assert.match(mapped, /Do not use Dropbox/);
    });
  }

  it("does not open Dropbox when the only mention is a refusal", () => {
    assert.equal(isClientFileAsk("Leave Dropbox alone and show Casey Sample's saved contact record."), false);
    assert.equal(isClientFileAsk("به Dropbox دست نزن و اطلاعات کیسی را نشان بده."), false);
    assert.equal(isClientFileAsk("Open the Dropbox folder for client id C-1001."), true);
  });

  it("replaces a newsletter preview when the next turn is a display-only visit", () => {
    const visit = "Let me review a proposed in-person visit: Jordan Example, December 2, 2026, 11:15 am Toronto time, forty-five minutes, Training Room. Display only; leave calendars and email untouched.";
    const other = "Please summarize that proposal again without opening a calendar.";
    assert.equal(asksStatedMeeting(visit), true);
    assert.equal(contentHoldKind(visit), "meeting");
    assert.equal(shouldReplacePreview(visit), true);
    assert.equal(shouldReplacePreview(other), true);
    assert.equal(shouldReplacePreview("Show what newsletter number 1 would look like for my life-insurance group. Do not deliver it."), false);
    const facts = meetingPreviewFacts(visit);
    assert.equal(facts.person, "Jordan Example");
    assert.equal(facts.place, "Training Room");
    assert.equal(facts.minutes, "45");
    assert.match(facts.when, /December 2, 2026/);
    assert.match(facts.time, /11:15/);
    assert.equal(facts.zone, "America/Toronto");
    const reply = meetingDetailReply(facts, true);
    assert.match(reply, /Training Room/);
    assert.match(reply, /45 minutes/);
    assert.match(reply, /Jordan Example/);
    assert.doesNotMatch(reply, /not signed in/i);
  });

  it("labels a named-only audience as the named people when the group is negated", () => {
    const line = "Show saved newsletter copy #1 for Casey Sample and Riley Sample only, not the life insurance group. List who is included. Do not send.";
    assert.equal(contentHoldKind(line), "newsletter");
    assert.equal(audienceRequest(line), "people");
    const shown = formatAudience(classifyAudience(LIFE, line), "Named recipients");
    assert.match(shown, /Casey Sample/);
    assert.match(shown, /Riley Sample/);
    assert.doesNotMatch(shown, /Jordan Example/);
    assert.doesNotMatch(shown, /Life Insurance Client/);
    assert.doesNotMatch(shown, /Morgan Sample/);
  });
});
