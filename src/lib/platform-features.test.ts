import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertLibraryWriter,
  copySnapshotsIntoNewsletter,
  editOwnCopy,
  filterArticles,
  normalizeArticleInput,
  reorderOwnArticles,
  sameAdvisor,
  sanitizeArticleHtml,
  snapshotPublished,
  type LibraryArticle,
} from "./article-library.ts";
import {
  missingBirthdayKey,
  personHasBirthday,
  planBirthdayRun,
  previewBirthdayCard,
  summarizeAdvisorNotice,
  zonedParts,
  type BirthdayPerson,
  type BirthdaySettings,
} from "./birthday-job.ts";
import { ribbonDirection, visibleAnnouncements, type Announcement } from "./news-ribbon.ts";
import { ISOLATED_TEST_BANNER } from "./isolated-test-desk.ts";
import { STAGING_BANNER, deskStatusBanner } from "./staging-banner.ts";
import { outboundBlocked, OUTBOUND_BLOCKED } from "./outbound-guard.ts";
import { externalSideEffectsBlocked } from "./isolated-test-desk.ts";
import { asksArchiveSearch, asksContactRecord, asksEmailThreadStatus, asksIssueDates, asksMeetingPreview, asksSavedCampaignReview, archiveSearchTerm, classifyAudience, matchingNewsletterCopies, meetingDetailReply, meetingPreviewFacts, namedPeople } from "./delivery-audience.ts";
import { eletterRecipient, isBareRefusal, isInboxAsk, taskKind } from "./advisor-intent.ts";
import { orchestrationControl } from "./orchestration.ts";
import { contentHoldKind, deliveryRequested, draftWithdrawalUpdate } from "./workspace-policy.ts";
import { prepareDeskCommand } from "./voice-desk.ts";
import fixture from "../../fixtures/sanitized-practice.fixture.json" with { type: "json" };

const baseSettings: BirthdaySettings = {
  enabled: true,
  source: "desk",
  timezone: "America/Toronto",
  feb29: "skip",
  templateVersion: 2,
  confirmedVersion: 2,
  cardTitle: "Happy birthday",
};

function person(partial: Partial<BirthdayPerson>): BirthdayPerson {
  return { contactId: "c1", name: "Casey Sample", email: "casey.sample@example.invalid", birthday: "1990-11-20", unsubscribed: false, ...partial };
}

describe("outbound guard does not depend on the database", () => {
  it("blocks a release environment even if a hosted database were configured", () => {
    const previous = process.env.UA_RELEASE_ENV;
    const url = process.env.DATABASE_URL;
    process.env.UA_RELEASE_ENV = "staging";
    process.env.DATABASE_URL = "postgres://example.invalid/db";
    try {
      assert.equal(outboundBlocked(), true);
      assert.equal(externalSideEffectsBlocked(), true);
    } finally {
      if (previous === undefined) delete process.env.UA_RELEASE_ENV;
      else process.env.UA_RELEASE_ENV = previous;
      if (url === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = url;
    }
  });

  it("does not block the ordinary unit-test process", () => {
    const previous = {
      UA_RELEASE_ENV: process.env.UA_RELEASE_ENV,
      UA_OUTBOUND_BLOCK: process.env.UA_OUTBOUND_BLOCK,
      UA_HOST_ENV: process.env.UA_HOST_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
      UA_ISOLATED_TEST: process.env.UA_ISOLATED_TEST,
    };
    delete process.env.UA_RELEASE_ENV;
    delete process.env.UA_OUTBOUND_BLOCK;
    delete process.env.UA_HOST_ENV;
    delete process.env.VERCEL_ENV;
    delete process.env.UA_ISOLATED_TEST;
    try {
      assert.equal(outboundBlocked(), false);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("article library", () => {
  const published: LibraryArticle = {
    id: 7,
    status: "published",
    title: "Time Value Of Money",
    bodyHtml: "<p>Waiting has a cost.</p>",
    bodyText: "Waiting has a cost.",
    imageUrl: "",
    imageAlt: "",
    sourceNote: "Internal note",
    authorNote: "Desk",
    topics: "money",
    language: "en",
    version: 3,
    updatedAt: "2026-11-20T00:00:00.000Z",
  };

  it("removes scripts and refuses an image without a description", () => {
    assert.equal(sanitizeArticleHtml("<p onclick=\"alert(1)\">Hi</p><script>bad()</script>"), "<p>Hi</p>");
    assert.throws(() => normalizeArticleInput({ title: "A", bodyHtml: "<p>B</p>", imageUrl: "https://example.invalid/a.jpg" }), /alt text/);
  });

  it("lets an advisor search published text and hides drafts", () => {
    const draft = { ...published, id: 8, status: "draft" as const, title: "Draft only" };
    const hits = filterArticles([published, draft], { text: "waiting", advisor: true });
    assert.deepEqual(hits.map((item) => item.id), [7]);
    assert.equal(filterArticles([draft], { advisor: true, text: "draft" }).length, 0);
  });

  it("copies a snapshot and leaves it unchanged when the library article changes", () => {
    assert.throws(() => assertLibraryWriter({ role: "advisor" }), /superadmin/);
    const snapshot = snapshotPublished({ ...published });
    const issue = copySnapshotsIntoNewsletter({ title: "Mine", articles: [] }, [snapshot], "new");
    const edited = { ...published, title: "Changed later", version: 4 };
    assert.equal(issue.articles[0].title, "Time Value Of Money");
    assert.equal(issue.articles[0].libraryVersion, 3);
    assert.notEqual(issue.articles[0].title, edited.title);
    const own = editOwnCopy(issue.articles[0], { body: "The advisor rewrote only this copy." });
    assert.equal(own.body, "The advisor rewrote only this copy.");
    assert.equal(own.libraryVersion, 3);
    assert.equal(published.bodyText, "Waiting has a cost.");
    const ordered = reorderOwnArticles(["Life", "Time", "Retirement"], 2, 0);
    assert.deepEqual(ordered, ["Retirement", "Life", "Time"]);
    assert.equal(sameAdvisor(4, 4), true);
    assert.equal(sameAdvisor(4, 9), false);
  });

  it("does not copy an archived article", () => {
    assert.throws(() => snapshotPublished({ ...published, status: "archived" }), /published/);
  });
});

describe("birthday job", () => {
  it("uses 9:00 America/Toronto in winter and summer", () => {
    const winter = zonedParts(new Date("2026-01-15T14:00:00.000Z"), "America/Toronto");
    const summer = zonedParts(new Date("2026-07-15T13:00:00.000Z"), "America/Toronto");
    assert.equal(winter.hour, "09");
    assert.equal(summer.hour, "09");
    assert.equal(winter.date, "2026-01-15");
  });

  it("matches a month and day without a birth year, and applies the February 29 choice", () => {
    const local = { year: "2026", month: "11", day: "20", hour: "09", minute: "00", date: "2026-11-20" };
    assert.equal(personHasBirthday(person({ birthday: "11-20" }), local, "skip"), true);
    const leap = { ...local, year: "2026", month: "03", day: "01", date: "2026-03-01" };
    assert.equal(personHasBirthday(person({ birthday: "1992-02-29" }), leap, "skip"), false);
    assert.equal(personHasBirthday(person({ birthday: "1992-02-29" }), leap, "march1"), true);
  });

  it("stays off, asks for one source, excludes people, and does not resend an unknown result", () => {
    const now = new Date("2026-11-20T14:00:00.000Z");
    const off = planBirthdayRun({ advisorId: 4, settings: { ...baseSettings, enabled: false }, people: [], claims: [], now, lastRunDate: "" });
    assert.match(off.notice, /off/);
    const missing = planBirthdayRun({ advisorId: 4, settings: { ...baseSettings, source: "" }, people: [], claims: [], now, lastRunDate: "" });
    assert.match(missing.notice, /Choose Unique Advisor contacts or one Dropbox/);
    const plan = planBirthdayRun({
      advisorId: 4,
      settings: baseSettings,
      now,
      lastRunDate: "",
      claims: [{ key: "4:quinn:birthday:2026", status: "unknown", providerId: "" }],
      people: [
        person({ contactId: "casey", name: "Casey Sample", birthday: "1980-11-20" }),
        person({ contactId: "quinn", name: "Quinn Sample", email: "quinn.sample@example.invalid", birthday: "1981-11-20", unsubscribed: true }),
        person({ contactId: "avery", name: "Avery Sample", email: "", birthday: "1982-11-20" }),
        person({ contactId: "morgan", name: "Morgan Sample", email: "morgan.sample@example.invalid", birthday: "1983-11-21" }),
      ],
    });
    assert.equal(plan.window, "run");
    assert.equal(plan.recipients.find((item) => item.contactId === "casey")?.action, "send");
    assert.equal(plan.recipients.find((item) => item.contactId === "quinn")?.reason, "unsubscribed");
    assert.equal(plan.recipients.find((item) => item.contactId === "avery")?.reason, "no email");
    assert.equal(plan.recipients.some((item) => item.contactId === "morgan"), false);
    const unknown = planBirthdayRun({
      advisorId: 4,
      settings: baseSettings,
      now,
      lastRunDate: "",
      claims: [{ key: "4:casey:birthday:2026", status: "unknown", providerId: "" }],
      people: [person({ contactId: "casey", birthday: "1980-11-20" })],
    });
    assert.equal(unknown.recipients[0].action, "hold");
    const failed = planBirthdayRun({
      advisorId: 4,
      settings: baseSettings,
      now,
      lastRunDate: "",
      claims: [{ key: "4:casey:birthday:2026", status: "failed", providerId: "" }],
      people: [person({ contactId: "casey", birthday: "1980-11-20" })],
    });
    assert.equal(failed.recipients[0].action, "retry");
    const doubled = planBirthdayRun({
      advisorId: 4,
      settings: baseSettings,
      now,
      lastRunDate: "",
      claims: [],
      people: [person({ contactId: "casey", birthday: "1980-11-20" }), person({ contactId: "casey", name: "Casey Sample", birthday: "1980-11-20" })],
    });
    assert.deepEqual(doubled.duplicateContactIds, ["casey"]);
    assert.equal(doubled.recipients.filter((item) => item.action === "send").length, 1);
    const both = planBirthdayRun({
      advisorId: 4,
      settings: { ...baseSettings, source: "desk+dropbox" as BirthdaySettings["source"] },
      now,
      lastRunDate: "",
      claims: [],
      people: [],
    });
    assert.match(both.notice, /one Dropbox file/);
  });

  it("does not flood missed days and does not call every result sent", () => {
    const now = new Date("2026-11-20T16:00:00.000Z");
    const missed = planBirthdayRun({ advisorId: 4, settings: baseSettings, people: [person({})], claims: [], now, lastRunDate: "2026-11-17" });
    assert.equal(missed.window, "missed_days");
    assert.equal(missed.recipients.length, 0);
    const notice = summarizeAdvisorNotice([{ name: "Casey Sample", outcome: "accepted" }, { name: "Quinn Sample", outcome: "skipped" }]);
    assert.match(notice, /1 accepted by the provider, 1 not accepted/);
    assert.match(notice, /not confirmed delivery/);
    assert.doesNotMatch(notice, /all sent/i);
    const caughtUp = planBirthdayRun({ advisorId: 4, settings: baseSettings, people: [person({ birthday: "1980-11-20" })], claims: [], now, lastRunDate: "2026-11-19" });
    assert.equal(caughtUp.window, "run");
    const missing = planBirthdayRun({
      advisorId: 4,
      settings: baseSettings,
      people: [person({ contactId: "no-date", name: "No Date", birthday: "" })],
      claims: [],
      now: new Date("2026-11-20T14:00:00.000Z"),
      lastRunDate: "",
    });
    assert.equal(missing.missingDates[0]?.repeat, false);
    assert.match(missing.notice, /Missing birthday dates, shown once: No Date/);
    const again = planBirthdayRun({
      advisorId: 4,
      settings: baseSettings,
      people: [person({ contactId: "no-date", name: "No Date", birthday: "" })],
      claims: [{ key: missingBirthdayKey(4, "no-date"), status: "skipped", providerId: "" }],
      now: new Date("2026-11-20T14:00:00.000Z"),
      lastRunDate: "",
    });
    assert.equal(again.missingDates[0]?.repeat, true);
    assert.doesNotMatch(again.notice, /shown once/);
    const card = previewBirthdayCard("Happy birthday, {{name}}.", { name: "Casey Sample" });
    assert.equal(card.sent, false);
    assert.match(card.text, /Casey Sample/);
  });

  it("requires a new confirmation when the card version changes", () => {
    const plan = planBirthdayRun({
      advisorId: 4,
      settings: { ...baseSettings, templateVersion: 3, confirmedVersion: 2 },
      people: [person({})],
      claims: [],
      now: new Date("2026-11-20T14:00:00.000Z"),
      lastRunDate: "",
    });
    assert.match(plan.notice, /Turn the birthday check on again/);
  });
});

describe("news ribbon", () => {
  const items: Announcement[] = [
    { id: 1, title: "Open", text: "Hello", link: "", priority: 2, language: "en", status: "published", startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z" },
    { id: 2, title: "Expired", text: "Old", link: "", priority: 1, language: "en", status: "published", startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-02-01T00:00:00.000Z" },
    { id: 3, title: "Draft", text: "Hidden", link: "", priority: 1, language: "en", status: "draft", startsAt: "", endsAt: "" },
    { id: 4, title: "خبر", text: "فارسی", link: "https://example.invalid/fa", priority: 1, language: "fa", status: "published", startsAt: "2026-11-01T00:00:00.000Z", endsAt: "" },
  ];

  it("shows only active published items and sets Farsi right to left", () => {
    const shown = visibleAnnouncements(items, new Date("2026-11-20T15:00:00.000Z"));
    assert.deepEqual(shown.map((item) => item.id), [4, 1]);
    assert.equal(ribbonDirection("fa"), "rtl");
    assert.equal(visibleAnnouncements(items, new Date("2026-11-20T15:00:00.000Z"), "fa").every((item) => item.language === "fa"), true);
  });
});

describe("protected acceptance wording still routes", () => {
  it("keeps the known newsletter, letter sentence, card, and drip facts", () => {
    assert.deepEqual(fixture.newsletterCopy1.articles.map((item) => item.title), ["Life Insurance", "Time Value Of Money", "Retirement Planning", "Keeping Beneficiary Information Updated", "Practice Follow-Up"]);
    assert.equal(fixture.newsletterCopy1.articles[2].body, "Retirement planning is a check of income for later years.");
    assert.equal(fixture.newsletterCopy1.articles[4].body, "This is a fictional acceptance-test article.");
    assert.deepEqual(fixture.newsletterCopy2.articles.map((item) => item.title), ["Life Insurance", "Retirement Planning", "Keeping Beneficiary Information Updated", "Time Value Of Money"]);
    assert.equal(fixture.letter.body, "This paragraph confirms the combined edit works.");
    assert.equal(fixture.card.body, "Thank you for your trust. It is a pleasure working with you.");
    assert.equal(fixture.drip.active, false);
    assert.equal(fixture.drip.step2WaitDays, 3);
    assert.equal(fixture.notADatabaseBackup, true);
  });

  it("still answers the previously failing requests", () => {
    const keep = "Before considering enrollment, let me inspect the actual saved messages and delays in Acceptance — Welcome Drip for Riley Sample and Avery Sample. Identify anyone who cannot receive it. Leave it inactive and make no changes.";
    assert.equal(asksSavedCampaignReview(keep), true);
    assert.equal(deliveryRequested(keep), false);
    assert.equal(contentHoldKind(keep), "campaign");
    const piece = "Which saved issues include a piece on the time value of money? Give their IDs without changing them.";
    assert.equal(asksArchiveSearch(piece), true);
    assert.deepEqual(matchingNewsletterCopies([fixture.newsletterCopy1, fixture.newsletterCopy2], archiveSearchTerm(piece)).map((hit) => hit.id), [1, 2]);
    const casey = "Without changing anything, show Casey Sample alone from Unique Advisor contacts, including email and tags. Do not look in Dropbox.";
    assert.equal(asksContactRecord(casey), true);
    assert.equal(isInboxAsk(casey), false);
    assert.equal(taskKind(casey), "contact-record");
    assert.equal(OUTBOUND_BLOCKED.includes("Nothing was sent"), true);
  });

  it("routes unseen English and Farsi paraphrases without sending", () => {
    const archive = "Look through the newsletter archive for a piece on the time value of money. Give their IDs. Do not change them.";
    assert.equal(asksArchiveSearch(archive), true);
    assert.equal(deliveryRequested(archive), false);
    assert.deepEqual(matchingNewsletterCopies([fixture.newsletterCopy1, fixture.newsletterCopy2], archiveSearchTerm(archive)).map((hit) => hit.id), [1, 2]);
    const casey = "Read Casey Sample from Unique Advisor contacts, including email and tags. Do not look in Dropbox.";
    assert.equal(asksContactRecord(casey), true);
    assert.equal(taskKind(casey), "contact-record");
    const card = "Preview the Thank You card for Casey Sample and Riley Sample. Do not send.";
    assert.deepEqual(namedPeople(card), ["Casey Sample", "Riley Sample"]);
    assert.equal(contentHoldKind(card), "e-card");
    assert.equal(deliveryRequested(card), false);
    const letter = "Show the saved letter to Riley Sample and do not send it.";
    assert.equal(eletterRecipient(letter), "Riley Sample");
    assert.equal(contentHoldKind(letter), "e-letter");
    const drip = "Walk through the saved messages and waits in the Acceptance — Welcome Drip. Leave it inactive and make no changes.";
    assert.equal(asksSavedCampaignReview(drip), true);
    assert.equal(deliveryRequested(drip), false);
    assert.equal(contentHoldKind(drip), "campaign");
    const pause = "Tell me whether the welcome drip is paused. Do not look up a contact.";
    assert.equal(contentHoldKind(pause), "campaign");
    assert.notEqual(taskKind(pause), "contact-record");
    assert.equal(prepareDeskCommand("نفرست"), "Do not send.");
    assert.equal(isBareRefusal("نفرست"), true);
    assert.equal(orchestrationControl("Do not send.").cancelStaged, true);
    assert.equal(deliveryRequested("Do not send."), false);
    const policies = "Which life insurance policies were issued more than 5 years ago? Read only. Do not send mail.";
    assert.equal(asksIssueDates(policies), true);
    assert.equal(contentHoldKind(policies), "issue-dates");
    const thread = "Monitor whether replies arrived on the locally stored email thread titled Signature Workflow Test. This is not a signature preview.";
    assert.equal(asksEmailThreadStatus(thread), true);
    assert.equal(contentHoldKind(thread), "email-thread");
    const meeting = "Review this proposed in-person meeting with Riley Sample on November 20, 2026 at 10:00 a.m. for 30 minutes at Test Office in Toronto. Do not book it and do not contact Outlook.";
    assert.equal(asksMeetingPreview(meeting), true);
    const facts = meetingPreviewFacts(meeting);
    const reply = meetingDetailReply(facts, true);
    assert.match(reply, /November 20, 2026/);
    assert.match(reply, /10:00 a\.m/);
    assert.match(reply, /30 minutes/);
    assert.match(reply, /Test Office/);
    assert.match(reply, /Riley Sample/);
    assert.match(reply, /Outlook was not contacted/);
    assert.match(reply, /not a report that Outlook is signed out/);
    const rows = fixture.contacts.map((item) => ({ name: item.name, email: item.email, tags: item.tags }));
    const audience = classifyAudience(rows, "Who can receive the life insurance client newsletter? Show the exclusions.");
    assert.deepEqual(audience.included.map((item) => item.name), ["Casey Sample", "Riley Sample", "Jordan Example"]);
    assert.deepEqual(audience.excluded.map((item) => item.name), ["Quinn Sample", "Avery Sample"]);
    assert.equal(draftWithdrawalUpdate().approval_state, "withdrawn");
    assert.equal(draftWithdrawalUpdate().deletesRows, false);
  });
});

describe("staging practice banner", () => {
  it("uses staging wording only for the staging label and keeps the isolated sentence", () => {
    const staging = deskStatusBanner({ isolatedTest: true, releaseLabel: "staging" });
    assert.equal(staging?.kind, "staging");
    assert.equal(staging?.text, STAGING_BANNER);
    assert.match(staging?.text || "", /not the tested acceptance desk/);
    assert.match(staging?.text || "", /Birthday checks are off/);
    const isolated = deskStatusBanner({ isolatedTest: true, releaseLabel: "" });
    assert.equal(isolated?.text, ISOLATED_TEST_BANNER);
    assert.equal(deskStatusBanner({ isolatedTest: false, releaseLabel: "" }), null);
    assert.equal(deskStatusBanner(null), null);
  });
});
