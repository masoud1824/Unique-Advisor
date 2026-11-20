import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvalFingerprint, approvalStillValid, audienceTag, chooseOpenNewsletter, chooseSavedLink, claimDelivery, contactDeliveryBlock, insurerLinksForFill, newsletterCopyAmbiguity, newsletterCopyQuestion, reviseNamedParagraph, acceptanceFormFallback } from "./desk-workflows.ts";
import { contentHoldKind, deliveryRequested, replyClaimsDelivery } from "./workspace-policy.ts";
import { campaignIntervalDays, campaignStepWait, cardMessageReplacement, isCampaignTimingEdit, isLetterParagraphEdit, isNewsletterArticleAdd, isNewsletterArticleRevision, isNewsletterDelivery, isNewsletterHold, isTaskSwitch, namedPreviewRecipient, newsletterArticleTarget, newsletterMoveTarget, suppliedArticle, taskKind } from "./advisor-intent.ts";
import { refersToAppointment } from "./calendar-span.ts";
import { orchestrationControl } from "./orchestration.ts";
import { cleanSteps } from "./drips.ts";
import { articlesMatch } from "./newsletter.ts";
import { personalize } from "./catalog.ts";

describe("shared workflow repair", () => {
  it("opens the newsletter that contains the named article and keeps every other article", () => {
    const issues = [
      { id: 1, title: "Other", articles: [{ title: "Markets", body: "Leave this." }] },
      {
        id: 2,
        title: "Test Newsletter",
        articles: [
          { title: "Life Insurance", body: "Keep one." },
          { title: "Retirement Planning", body: "Keep two." },
          { title: "Time Value Of Money", body: "Keep three." },
        ],
      },
    ];
    const chosen = chooseOpenNewsletter(issues, "Move “Time Value of Money” to the second position. Do not send.");
    assert.equal(chosen?.id, 2);
    assert.equal(chosen?.articles[0].body, "Keep one.");
    assert.equal(chosen?.articles[2].body, "Keep three.");
    const copies = [
      { id: 9, title: "Test Newsletter", articles: [{ title: "Life Insurance", body: "Older." }] },
      { id: 4, title: "Test Newsletter", articles: [{ title: "Life Insurance", body: "Newer." }] },
    ];
    const open = "Open the saved Test Newsletter and show its articles in their current order. Do not create another newsletter or send anything.";
    assert.equal(chooseOpenNewsletter(copies, open), null);
    assert.equal(newsletterCopyAmbiguity(copies, open).length, 2);
    assert.match(newsletterCopyQuestion(copies), /saved copy #9/);
    assert.match(newsletterCopyQuestion(copies), /saved copy #4/);
    assert.match(newsletterCopyQuestion(copies), /did not open or change/i);
    assert.equal(chooseOpenNewsletter(copies, "Open saved copy #4 of the Test Newsletter. Do not send.")?.id, 4);
    assert.equal(chooseOpenNewsletter(copies, open, "Preview of “Test Newsletter”, saved copy #9."), null);
    assert.equal(chooseOpenNewsletter(copies, "Show those articles again. Do not send.", "Preview of “Test Newsletter”, saved copy #9.")?.id, 9);
    assert.equal(chooseOpenNewsletter(copies, open, "", 4)?.id, 4);
    const openMove = "Move Time Value of Money to the second position in the open Test Newsletter. Keep every article’s wording unchanged and show the updated preview. Do not send.";
    const both = [
      { id: 1, title: "Test Newsletter", articles: [{ title: "Time Value Of Money", body: "A." }, { title: "Retirement Planning", body: "One. Two." }] },
      { id: 2, title: "Test Newsletter", articles: [{ title: "Time Value Of Money", body: "B." }, { title: "Retirement Planning", body: "One. Two." }] },
    ];
    assert.equal(chooseOpenNewsletter(both, openMove, "Preview of “Test Newsletter”, saved copy #1.")?.id, 1);
    assert.equal(chooseOpenNewsletter(both, openMove, "", 1)?.id, 1);
    assert.equal(chooseOpenNewsletter(both, open, "Preview of “Test Newsletter”, saved copy #1."), null);
    assert.equal(chooseOpenNewsletter(both, openMove, "There are 2 saved copies of “Test Newsletter”: saved copy #1, saved copy #2. I did not open or change any of them."), null);
    const explicitShorten = "In Test Newsletter saved copy #1, shorten Retirement Planning to one sentence. Keep all other wording unchanged. Do not send.";
    const numberedShorten = "Shorten article 3, Retirement Planning, to one sentence. Keep every other article unchanged. Do not send.";
    assert.equal(isNewsletterArticleRevision(explicitShorten), true);
    assert.equal(isNewsletterArticleRevision(numberedShorten), true);
    assert.equal(newsletterArticleTarget(explicitShorten).name, "Retirement Planning");
    assert.equal(newsletterArticleTarget(explicitShorten).sentences, 1);
    assert.deepEqual(newsletterArticleTarget(numberedShorten), { index: 2, name: "Retirement Planning", sentences: 1 });
    assert.equal(chooseOpenNewsletter(both, explicitShorten, "")?.id, 1);
    assert.equal(chooseOpenNewsletter(both, numberedShorten, "Preview of “Test Newsletter”, saved copy #1.")?.id, 1);
    assert.equal(chooseOpenNewsletter(both, numberedShorten, ""), null);
  });

  it("changes only the named paragraph and ignores the greeting", () => {
    const body = [
      "Dear [Contact Name],",
      "This acceptance letter is a fictional draft about reviewing retirement income.",
      "The second paragraph stays available for a revision and is not a client record.",
      "Nothing in this draft has been sent.",
    ].join("\n\n");
    const revised = reviseNamedParagraph(body, "Change the second paragraph of the Acceptance — Retirement Note to This paragraph was revised on its own.");
    assert.equal(revised.changed, true);
    const parts = revised.body.split("\n\n");
    assert.equal(parts[0], "Dear [Contact Name],");
    assert.equal(parts[1], "This acceptance letter is a fictional draft about reviewing retirement income.");
    assert.equal(parts[2], "This paragraph was revised on its own.");
    assert.equal(parts[3], "Nothing in this draft has been sent.");
    assert.equal(revised.label, "second");
    const combined = "Open Acceptance — Retirement Note. Replace only its second body paragraph with ‘This paragraph was revised on its own.’ Keep the greeting and all other paragraphs unchanged. Show the preview. Do not send.";
    assert.equal(isLetterParagraphEdit(combined), true);
    assert.equal(contentHoldKind(combined), "e-letter");
    const combinedRevised = reviseNamedParagraph(body, combined);
    assert.equal(combinedRevised.changed, true);
    const combinedParts = combinedRevised.body.split("\n\n");
    assert.equal(combinedParts[0], "Dear [Contact Name],");
    assert.equal(combinedParts[1], "This acceptance letter is a fictional draft about reviewing retirement income.");
    assert.equal(combinedParts[2], "This paragraph was revised on its own.");
    assert.equal(combinedParts[3], "Nothing in this draft has been sent.");
    const already = reviseNamedParagraph(combinedRevised.body, combined);
    assert.equal(already.changed, false);
    assert.equal(already.already, true);
    assert.equal(already.body, combinedRevised.body);
  });

  it("excludes unsubscribed contacts and contacts with no email", () => {
    assert.equal(contactDeliveryBlock("Acceptance, Unsubscribed, Life Insurance Client", "quinn.sample@example.invalid"), "Unsubscribed");
    assert.equal(contactDeliveryBlock("Acceptance, Life Insurance Client", ""), "No email is recorded");
    assert.equal(contactDeliveryBlock("Acceptance, Life Insurance Client", "casey.sample@example.invalid"), "");
  });

  it("binds approval to the exact version and refuses a duplicate", () => {
    const packet = {
      kind: "newsletter" as const,
      recipients: [{ name: "Casey Sample", email: "casey.sample@example.invalid" }],
      subject: "Test Newsletter",
      design: "pine",
      body: "Keep one.",
      attachments: [],
    };
    const approved = approvalFingerprint(packet);
    assert.equal(approvalStillValid(approved, packet), true);
    assert.equal(approvalStillValid(approved, { ...packet, body: "Changed." }), false);
    const sent = new Set<string>();
    assert.equal(claimDelivery(sent, approved, () => ({ ok: true, detail: "simulated" })).delivered, true);
    const again = claimDelivery(sent, approved, () => ({ ok: true, detail: "should not run" }));
    assert.equal(again.delivered, false);
  });

  it("keeps preview, document, signature, email, and contact questions off delivery", () => {
    const lines = [
      ["Preview the ivari form from Useful Links. Do not send.", "form"],
      ["Preview the form from the Useful Link “Acceptance — ivari forms”. Do not send.", "form"],
      ["Show the Assistant Test document for client id C-1001. Do not send.", "document"],
      ["Preview the signature request. Do not send.", "signature"],
      ["Show the test email preview. Do not send.", "email"],
      ["Who can receive mail among life insurance clients? Do not send.", "contacts"],
      ["Show my calendar. Do not book a meeting.", "calendar"],
    ] as const;
    for (const [line, kind] of lines) {
      assert.equal(deliveryRequested(line), false, line);
      assert.equal(contentHoldKind(line), kind, line);
      assert.equal(taskKind(line), kind, line);
    }
    assert.equal(acceptanceFormFallback("Canada Life forms").length, 0);
    assert.equal(acceptanceFormFallback("Acceptance — ivari forms")[0].version, "acceptance-2026-11-18");
    const links = [
      { label: "ivari forms and guides", url: "https://ivari.ca/resources/faq/forms-and-guides/" },
      { label: "Acceptance — ivari forms", url: "https://ivari.ca/resources/faq/forms-and-guides/" },
    ];
    assert.equal(chooseSavedLink(links, "Preview the ivari form from Useful Links. Do not send.").length, 2);
    assert.equal(chooseSavedLink(links, "Preview the form from the Useful Link “Acceptance — ivari forms”. Do not send.")[0].label, "Acceptance — ivari forms");
    assert.equal(insurerLinksForFill(links, "Fill the ivari insurance application LP257 for client id C-1001. Do not send it.").length, 1);
    assert.equal(insurerLinksForFill(links, "Fill the ivari insurance application LP257 for client id C-1001. Do not send it.")[0].label, "ivari forms and guides");
    const tags = ["Acceptance", "Life Insurance Client", "Unsubscribed", "TFSA Client", "Dropbox fictional"];
    assert.equal(audienceTag(tags, "Who can receive mail among life insurance clients? Do not send."), "Life Insurance Client");
    assert.equal(audienceTag(tags, "Show my calendar. Do not book a meeting."), "");
    assert.equal(replyClaimsDelivery("No recipient is needed until you prepare delivery. Nothing was sent."), false);
    assert.equal(replyClaimsDelivery("Nothing was booked."), false);
    assert.equal(replyClaimsDelivery("Nothing was started."), false);
    assert.equal(replyClaimsDelivery("The newsletter was sent to Casey Sample."), true);
    assert.equal(replyClaimsDelivery("The meeting is booked."), true);
  });

  it("reads life-insurance clients from the desk instead of treating the question as an appointment", () => {
    const line = "Who can receive mail among life insurance clients in my Unique Advisor database? Show eligible names and exclusions with reasons. Do not send anything.";
    assert.equal(deliveryRequested(line), false);
    assert.equal(contentHoldKind(line), "contacts");
    assert.equal(taskKind(line), "contacts");
    assert.equal(refersToAppointment(line), false);
    assert.equal(refersToAppointment("Who is it with?"), true);
    const control = orchestrationControl(line);
    assert.equal(control.desk, true);
    assert.equal(control.conversational, false);
  });

  it("opens a saved newsletter when send is negated later in the same sentence", () => {
    const line = "Open the saved Test Newsletter and show its articles in their current order. Do not create another newsletter or send anything.";
    assert.equal(deliveryRequested(line), false);
    assert.equal(isNewsletterDelivery(line), false);
    assert.equal(isNewsletterHold(line), true);
    assert.equal(contentHoldKind(line), "newsletter");
    assert.equal(taskKind(line), "newsletter");
    assert.equal(isTaskSwitch(line), false);
    assert.equal(deliveryRequested("Send the Thank You card to Casey Sample. Do not book a meeting."), true);
  });

  it("moves an article named without quotes and keeps Of and of as the same title", () => {
    const line = "Move Time Value of Money to the second position in the open Test Newsletter. Keep every article’s wording unchanged and show the updated preview. Do not send.";
    assert.deepEqual(newsletterMoveTarget(line), { name: "Time Value of Money", to: 1, sourceIndex: null, relative: 0 });
    assert.equal(contentHoldKind(line), "newsletter");
    assert.equal(deliveryRequested(line), false);
  });

  it("keeps both sentences of a card message and does not treat the word note as a letter", () => {
    const trust = "Change the Thank You card message to: Thank you for your trust. It is a pleasure working with you. Show the updated card design and message. Do not send.";
    assert.equal(cardMessageReplacement(trust), "Dear [Contact Name],\n\nThank you for your trust. It is a pleasure working with you.");
    assert.equal(contentHoldKind(trust), "e-card");
    const restore = "Change the Thank You card message to \"Thank you. A short note, not a pitch — I appreciate you sending people this way.\" Do not send.";
    assert.equal(cardMessageReplacement(restore), "Dear [Contact Name],\n\nThank you. A short note, not a pitch — I appreciate you sending people this way.");
    assert.equal(contentHoldKind(restore), "e-card");
    assert.equal(contentHoldKind("Preview the Acceptance — Retirement Note. Do not send."), "e-letter");
  });

  it("changes only one drip step wait and leaves the campaign interval alone", () => {
    const line = "Change only step 2 of the Acceptance — Welcome Drip so it waits 3 days after step 1. Do not change the whole campaign timing. Do not start the campaign.";
    assert.deepEqual(campaignStepWait(line), { step: 2, days: 3 });
    assert.equal(isCampaignTimingEdit(line), false);
    assert.equal(contentHoldKind(line), "campaign");
    assert.equal(deliveryRequested(line), false);
    const fortnight = "Change the Welcome Drip timing to every 2 weeks. Do not start the campaign.";
    assert.equal(campaignStepWait(fortnight), null);
    assert.equal(campaignIntervalDays(fortnight), 14);
    assert.equal(isCampaignTimingEdit(fortnight), true);
    assert.deepEqual(cleanSteps([{ title: "One", body: "A", waitDays: 3, extra: "no" }]), [{ title: "One", body: "A", waitDays: 3 }]);
  });

  it("routes the Farsi article move, the supplied fifth article, and a named card preview without delivery", () => {
    const farsi = "Move the fourth article to the second position. Keep every article’s wording unchanged. Do not send.";
    const original = [
      { title: "Life Insurance", body: "Keep one." },
      { title: "Retirement Planning", body: "One sentence." },
      { title: "Keeping Beneficiary Information Updated", body: "Keep three." },
      { title: "Time Value Of Money", body: "Keep four." },
    ];
    const next = [...original];
    const [moved] = next.splice(3, 1);
    next.splice(1, 0, moved);
    assert.equal(next.map((item) => item.title).join("|"), "Life Insurance|Time Value Of Money|Retirement Planning|Keeping Beneficiary Information Updated");
    assert.equal(next.every((item, index) => original.some((article) => article.title === item.title && article.body === item.body)), true);
    assert.equal(articlesMatch(original, next), false);
    assert.equal(articlesMatch(next, next), true);
    assert.equal(orchestrationControl(farsi).conversational, false);
    assert.equal(taskKind(farsi), "newsletter");
    const add = "Add a fifth article to the open newsletter. Title: Practice Follow-Up. Body: This is a fictional acceptance-test article. Save the updated draft for future use and show the preview. Keep the first four articles unchanged. Do not send.";
    assert.equal(isNewsletterArticleAdd(add), true);
    assert.equal(isNewsletterHold(add), true);
    assert.equal(contentHoldKind(add), "newsletter");
    assert.equal(deliveryRequested(add), false);
    assert.deepEqual(suppliedArticle(add), { title: "Practice Follow-Up", body: "This is a fictional acceptance-test article." });
    assert.equal(chooseOpenNewsletter(
      [
        { id: 1, title: "Test Newsletter", articles: original },
        { id: 2, title: "Test Newsletter", articles: original },
      ],
      add,
      "Preview of “Test Newsletter”, saved copy #1.",
    )?.id, 1);
    assert.equal(orchestrationControl(add).conversational, false);
    const added = [...original, { title: "Practice Follow-Up", body: "This is a fictional acceptance-test article." }];
    assert.equal(articlesMatch(added, added), true);
    assert.equal(articlesMatch(original, added), false);
    assert.equal(added.slice(0, 4).every((item, index) => item.title === original[index].title && item.body === original[index].body), true);
    const card = "Prepare a preview of the Thank You card for Casey Sample only. Show the recipient and the full card. Do not send.";
    assert.equal(namedPreviewRecipient(card), "Casey Sample");
    assert.equal(contentHoldKind(card), "e-card");
    assert.equal(deliveryRequested(card), false);
    assert.equal(orchestrationControl(card).conversational, false);
    assert.equal(personalize("Dear [Contact Name],\n\nThank you. A short note, not a pitch — I appreciate you sending people this way.", "Casey Sample"), "Dear Casey Sample,\n\nThank you. A short note, not a pitch — I appreciate you sending people this way.");
  });
});
