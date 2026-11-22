import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addArticle,
  archiveNewsletter,
  article,
  createNewsletter,
  duplicateNewsletter,
  editArticle,
  emptyArchive,
  latestVersion,
  newsletterArchiveTurn,
  planNewsletterSend,
  previewNewsletter,
  removeArticle,
  reorderArticles,
  reopenNewsletter,
  searchNewsletters,
  simulateNewsletterSend,
  NEWSLETTER_APPROVAL,
} from "./newsletter-archive.ts";

const now = "2026-11-18T12:00:00Z";
const sender = "desk@example.invalid";
const advisor = "34";
const other = "35";

function stories(count: number) {
  return Array.from({ length: count }, (_, index) => article(
    `Article ${index + 1}`,
    index === 0 ? "A **bold** opening." : `Body ${index + 1}.`,
    index === 1 ? ["/images/story.png"] : [],
    index === 2 ? [{ label: "Read more", href: "https://example.invalid/story" }] : [],
  ));
}

describe("newsletter archive", () => {
  it("saves advisor and assistant newsletters with 1, 2, 3, and more articles without sending", () => {
    let state = emptyArchive();
    const made = [];
    for (const count of [1, 2, 3, 4]) {
      const created = createNewsletter(state, {
        advisorId: count % 2 ? advisor : advisor,
        createdBy: count % 2 ? "advisor" : "assistant",
        title: `${count} stories`,
        articles: stories(count),
        now,
      });
      state = created.state;
      made.push(created.newsletter);
      assert.equal(created.newsletter.versions[0].articles.length, count);
      assert.equal(state.sends.length, 0);
      assert.equal(created.newsletter.archived, false);
    }
    assert.deepEqual(made.map((item) => item.createdBy), ["advisor", "assistant", "advisor", "assistant"]);
  });

  it("adds, edits, deletes, and reorders articles, and replaces only the second", () => {
    let state = createNewsletter(emptyArchive(), {
      advisorId: advisor,
      createdBy: "advisor",
      title: "Planning",
      articles: stories(3),
      now,
    }).state;
    const id = state.newsletters[0].id;
    state = addArticle(state, advisor, id, article("Retirement", "A fourth article."), now).state;
    assert.equal(latestVersion(state.newsletters[0]).articles.length, 4);
    state = editArticle(state, advisor, id, 0, { ...latestVersion(state.newsletters[0]).articles[0], text: "Edited first." }, now).state;
    state = removeArticle(state, advisor, id, 3, now).state;
    state = reorderArticles(state, advisor, id, 2, 0, now).state;
    const headings = latestVersion(state.newsletters[0]).articles.map((item) => item.heading);
    assert.deepEqual(headings, ["Article 3", "Article 1", "Article 2"]);
    const before = latestVersion(state.newsletters[0]).articles.map((item) => item.text);
    const replaced = editArticle(state, advisor, id, 1, { ...latestVersion(state.newsletters[0]).articles[1], heading: "Market note", text: "Only this article changes." }, now);
    assert.equal(replaced.ok, true);
    if (!replaced.ok) return;
    const after = latestVersion(replaced.newsletter).articles;
    assert.equal(after[1].text, "Only this article changes.");
    assert.equal(after[0].text, before[0]);
    assert.equal(after[2].text, before[2]);
    assert.equal(replaced.state.sends.length, 0);
  });

  it("shows images, links, and formatting in desktop and mobile previews", () => {
    const version = createNewsletter(emptyArchive(), {
      advisorId: advisor,
      createdBy: "assistant",
      title: "Preview",
      subject: "Preview subject",
      articles: stories(3),
      now,
    }).newsletter.versions[0];
    for (const width of ["desktop", "mobile"] as const) {
      const html = previewNewsletter(version, sender, width);
      assert.match(html, width === "desktop" ? /max-width:640px/ : /max-width:360px/);
      assert.match(html, /Article 1/);
      assert.match(html, /Article 2/);
      assert.match(html, /Article 3/);
      assert.match(html, /<strong>bold<\/strong>/);
      assert.match(html, /src="\/images\/story.png"/);
      assert.match(html, /href="https:\/\/example.invalid\/story"/);
      assert.match(html, /Preview subject/);
      assert.match(html, new RegExp(sender));
    }
  });

  it("reopens, searches, duplicates, and revises an archived newsletter", () => {
    const created = createNewsletter(emptyArchive(), {
      advisorId: advisor,
      createdBy: "assistant",
      title: "Life Insurance Newsletter",
      tags: ["life insurance"],
      articles: [article("Introduction", "Original introduction."), article("Coverage", "The second article.")],
      now: "2026-10-15T12:00:00Z",
    });
    const archived = archiveNewsletter(created.state, advisor, created.newsletter.id);
    assert.equal(archived.ok, true);
    if (!archived.ok) return;
    const found = searchNewsletters(archived.state, advisor, "Find my life insurance newsletter");
    assert.equal(found.length, 1);
    assert.equal(searchNewsletters(archived.state, other, "life insurance").length, 0);
    const reopened = reopenNewsletter(archived.state, advisor, created.newsletter.id);
    assert.equal(reopened.ok, true);
    if (!reopened.ok) return;
    assert.equal(latestVersion(reopened.newsletter).articles[0].text, "Original introduction.");
    const copy = duplicateNewsletter(reopened.state, advisor, created.newsletter.id, now);
    assert.equal(copy.ok, true);
    if (!copy.ok) return;
    const revised = editArticle(copy.state, advisor, copy.newsletter.id, 0, { ...copy.newsletter.versions[0].articles[0], text: "Revised introduction." }, now);
    assert.equal(revised.ok, true);
    if (!revised.ok) return;
    const original = revised.state.newsletters.find((item) => item.id === created.newsletter.id);
    assert.equal(original && latestVersion(original).articles[0].text, "Original introduction.");
    assert.equal(latestVersion(revised.newsletter).articles[1].text, "The second article.");
  });

  it("sends only after exact approval, withdraws it after a change, and keeps the sent version", () => {
    const created = createNewsletter(emptyArchive(), {
      advisorId: advisor,
      createdBy: "advisor",
      title: "Holiday notes",
      articles: stories(2),
      now,
    });
    const request = "Send this fictional newsletter to life insurance clients from the database";
    const planned = planNewsletterSend(created.state, { advisorId: advisor, newsletterId: created.newsletter.id, request, sender });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.deepEqual(planned.audience.recipients.map((item) => item.name), ["Casey Sample", "Riley Sample"]);
    assert.match(planned.audience.exclusions.join("\n"), /Quinn Sample/);
    assert.match(planned.preview, /Nothing has been sent/);
    const refused = simulateNewsletterSend(created.state, {
      advisorId: advisor, newsletterId: created.newsletter.id, request, sender, approval: "send it", fingerprint: planned.fingerprint, now,
    });
    assert.equal(refused.ok, false);
    const sent = simulateNewsletterSend(created.state, {
      advisorId: advisor, newsletterId: created.newsletter.id, request, sender, approval: NEWSLETTER_APPROVAL, fingerprint: planned.fingerprint, now,
    });
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.emailed, false);
    assert.equal(sent.state.newsletters[0].archived, true);
    const snapshot = sent.state.sends[0].snapshot.articles[1].text;
    const edited = editArticle(sent.state, advisor, created.newsletter.id, 1, { ...latestVersion(sent.state.newsletters[0]).articles[1], text: "Changed after sending." }, now);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.equal(edited.state.sends[0].snapshot.articles[1].text, snapshot);
    assert.notEqual(latestVersion(edited.newsletter).articles[1].text, snapshot);
    const stale = simulateNewsletterSend(edited.state, {
      advisorId: advisor, newsletterId: created.newsletter.id, request, sender, approval: NEWSLETTER_APPROVAL, fingerprint: planned.fingerprint, now,
    });
    assert.equal(stale.ok, false);
    assert.match(stale.ok ? "" : stale.error, /withdrawn/);
  });

  it("filters either contact source and does not repeat a successful delivery", () => {
    const created = createNewsletter(emptyArchive(), {
      advisorId: advisor, createdBy: "advisor", title: "Thanks", articles: stories(1), now,
    });
    const named = planNewsletterSend(created.state, {
      advisorId: advisor,
      newsletterId: created.newsletter.id,
      request: "Send this fictional newsletter to Jordan Example from the Dropbox contact file",
      sender,
    });
    assert.equal(named.ok, true);
    if (!named.ok) return;
    assert.deepEqual(named.audience.recipients.map((item) => item.email), ["jordan.example@example.invalid"]);
    const missing = planNewsletterSend(created.state, {
      advisorId: advisor,
      newsletterId: created.newsletter.id,
      request: "Send this fictional newsletter to Jordan Example from the database",
      sender,
    });
    assert.equal(missing.ok, false);
    const first = simulateNewsletterSend(created.state, {
      advisorId: advisor,
      newsletterId: created.newsletter.id,
      request: "Send this fictional newsletter to Casey Sample and Riley Sample from the database",
      sender,
      approval: NEWSLETTER_APPROVAL,
      fingerprint: planNewsletterSend(created.state, {
        advisorId: advisor,
        newsletterId: created.newsletter.id,
        request: "Send this fictional newsletter to Casey Sample and Riley Sample from the database",
        sender,
      }).ok ? (planNewsletterSend(created.state, {
        advisorId: advisor,
        newsletterId: created.newsletter.id,
        request: "Send this fictional newsletter to Casey Sample and Riley Sample from the database",
        sender,
      }) as { fingerprint: string }).fingerprint : "",
      now,
      failAddresses: ["riley.sample@example.invalid"],
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first.recipients.map((item) => item.result), ["simulated", "failed"]);
    const retryPlan = planNewsletterSend(first.state, {
      advisorId: advisor,
      newsletterId: created.newsletter.id,
      request: "Send this fictional newsletter to Casey Sample and Riley Sample from the database",
      sender,
    });
    assert.equal(retryPlan.ok, true);
    if (!retryPlan.ok) return;
    assert.deepEqual(retryPlan.audience.recipients.map((item) => item.email), ["riley.sample@example.invalid"]);
    assert.match(retryPlan.audience.exclusions.join("\n"), /Casey Sample/);
    const retry = simulateNewsletterSend(first.state, {
      advisorId: advisor,
      newsletterId: created.newsletter.id,
      request: "Send this fictional newsletter to Casey Sample and Riley Sample from the database",
      sender,
      approval: NEWSLETTER_APPROVAL,
      fingerprint: retryPlan.fingerprint,
      now,
    });
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.recipients.length, 1);
    assert.equal(retry.recipients[0].result, "simulated");
    assert.equal(retry.state.sends.length, 2);
    assert.equal(retry.state.sends[0].snapshot.articles[0].text, retry.state.sends[1].snapshot.articles[0].text);
  });

  it("understands save, find, revise, and article conversation without sending", () => {
    const saved = newsletterArchiveTurn(emptyArchive(), {
      advisorId: advisor,
      request: "Create a retirement newsletter and save it for later",
      sender,
      now,
    });
    assert.match(saved.reply, /was not sent/);
    assert.equal(saved.state.sends.length, 0);
    const found = newsletterArchiveTurn(saved.state, { advisorId: advisor, request: "Find my retirement newsletter", sender, now });
    assert.match(found.reply, /Retirement Newsletter/);
    const added = newsletterArchiveTurn(found.state, { advisorId: advisor, request: "Add an article about retirement", sender, now });
    assert.equal(latestVersion(added.state.newsletters[0]).articles.length, 2);
    const replaced = newsletterArchiveTurn(added.state, {
      advisorId: advisor,
      request: 'Replace the second article with heading "Estate note" and text "A revised fictional note."',
      sender,
      now,
    });
    const articles = latestVersion(replaced.state.newsletters[0]).articles;
    assert.equal(articles[1].heading, "Estate note");
    assert.match(articles[0].text, /saved retirement draft/);
    const older = createNewsletter(emptyArchive(), {
      advisorId: advisor,
      createdBy: "advisor",
      title: "October letter",
      articles: [article("Introduction", "October opening."), article("Rates", "Leave this.")],
      now: "2026-10-02T12:00:00Z",
    }).state;
    const revised = newsletterArchiveTurn(older, {
      advisorId: advisor,
      request: "Use last month's newsletter but change the introduction",
      sender,
      now,
    });
    assert.match(revised.reply, /nothing was sent/i);
    assert.equal(latestVersion(revised.state.newsletters[0]).articles[0].text, "October opening.");
    assert.equal(latestVersion(revised.state.newsletters[1]).articles[0].text, "Revised introduction. The other articles are unchanged.");
    assert.equal(latestVersion(revised.state.newsletters[1]).articles[1].text, "Leave this.");
  });
});
