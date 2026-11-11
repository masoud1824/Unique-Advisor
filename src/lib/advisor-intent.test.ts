import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agreesToSendCard, asksForPlan, asksToComposeEmail, asksToResume, batchAwaitingYes, campaignAudience, campaignAwaitingYes, cardAwaitingApprove, cardAwaitingYes, cardConfirmLine, cardDoubtAllowed, cardDoubtLine, cardSentLine, cardTitleHint, contactPhrase, decideTurn, declinesCard, earlierDraftReply, editListedText, eletterAwaitingYes, fileSubject, freshDraft, grokDoubtReply, heardCommand, isCalendarAsk, isCampaignAsk, isCardAsk, isEletterAsk, isFileAsk, isInboxAsk, isNewsletterAsk, isNewsletterEdit, isOnboardingDemo, isReviewAsk, isRevisionAsk, isStandaloneDraft, isTaskSwitch, isZoomAsk, looksLikeInstruction, matchCardByName, newsletterArticle, newsletterAwaitingYes, newsletterConfirmLine, newsletterDropIndex, newsletterReadyLine, newsletterRecipients, newsletterTitle, newsletterTopics, onboardingDraft, parseHeardJob, pendingQuestion, revisionFollows, revisionMessages, revisionOf, rewriteAllowed, ruleCardPhrases, shouldIgnorePending, showUnclearChoice, splitSecretaryTasks, taskKind, textHitsRuleCard, tidyHeard, toolsAllowed, workloadPlan, deskKeepsTurn, eletterFromRequest, eletterRecipient, yesApplies } from "./advisor-intent.ts";
import { SECRETARY_RULES, taskOn } from "./secretary-rules.ts";
import { contactMatchesQuery, resolveSpokenContact } from "./contact-match.ts";
import { cardHtml, isWebsiteLine, websiteButtonHtml, websiteHref } from "./advisor-website.ts";

const liveCards = [
  { id: "welcome", title: "Welcome" },
  { id: "anniversary", title: "Milestone Anniversary" },
  { id: "saved-halloween", title: "Halloween" },
  { id: "shared-12", title: "Thank You..." },
  { id: "shared-11", title: "Happy Holidays! 🎁" },
  { id: "shared-10", title: "Happy Birthday! 🎂" },
  { id: "shared-9", title: "Season's Greetings" },
  { id: "shared-8", title: "Happy Norooz" },
  { id: "thankyou", title: "Thank You" },
];

describe("misheard advisor commands", () => {
  it("treats a thank-you card, even with the filler word massage, as an e-card for the contact", () => {
    const line = "send a thank you card to massage to Masoud Zangeneh";
    assert.equal(isCardAsk(tidyHeard(line)), true);
    assert.equal(contactPhrase(line), "Masoud Zangeneh");
    assert.equal(cardTitleHint(line), "Thank You");
    assert.equal(contactPhrase("send ecard to Masoud Zangeneh"), "Masoud Zangeneh");
    assert.equal(contactPhrase("send a thank you card to Masoud Zangeneh"), "Masoud Zangeneh");
    for (const line of [
      "send ecard to Majid Hashemi",
      "send e-card to Majid Hashemi",
      "send a card to Majid Hashemi",
      "send greeting card to Majid Hashemi",
      "send thank you card to Majid Hashemi",
      "send Majid Hashemi a thank you card",
    ]) {
      assert.equal(isCardAsk(line), true, line);
      assert.equal(contactPhrase(line), "Majid Hashemi", line);
    }
    const namedFirst = matchCardByName("send Majid Hashemi a thank you card", liveCards);
    assert.ok(namedFirst && "card" in namedFirst);
    if (namedFirst && "card" in namedFirst) assert.equal(namedFirst.card.title, "Thank You...");
    assert.equal(agreesToSendCard("yes"), true);
    assert.equal(agreesToSendCard("Yes."), true);
    assert.equal(agreesToSendCard("yeah send it"), true);
    assert.equal(agreesToSendCard("send it"), true);
    assert.equal(agreesToSendCard("send the e-card"), true);
    assert.equal(agreesToSendCard("send a thank you card to Majid Hashemi"), false);
    assert.equal(agreesToSendCard("yes send a thank you card to Majid Hashemi"), false);
    assert.equal(declinesCard("No"), true);
    assert.equal(declinesCard("No."), true);
    assert.equal(declinesCard("send a thank you card to Majid Hashemi"), false);
    const confirm = "Just to confirm: send the Thank You... e-card to Majid Hashemi?";
    const withNote = [
      { role: "user", content: "send a thank you card to Majid Hashemi" },
      { role: "assistant", content: confirm },
      { role: "assistant", content: "No newsletter has gone out in the last 30 days." },
      { role: "user", content: "yes" },
    ];
    assert.equal(cardAwaitingYes(withNote), true);
    assert.equal(cardAwaitingYes([
      { role: "user", content: "book a zoom meeting with Majid Hashemi tomorrow at 8 pm" },
      { role: "assistant", content: "Just to confirm: a 30-minute Zoom meeting with Majid Hashemi on Saturday, Nov 7 at 8:00 PM Toronto time. Shall I book it?" },
      { role: "user", content: "yes" },
    ]), false);
    assert.equal(cardAwaitingApprove([
      { role: "assistant", content: "The e-card “Thank You...” is ready for Majid Hashemi. It has not been sent. Press Approve and send." },
      { role: "user", content: "yes" },
    ]), true);
    assert.equal(cardAwaitingYes([
      { role: "assistant", content: confirm },
      { role: "user", content: "yes" },
      { role: "assistant", content: "Sent — the Thank You... e-card is on its way to Majid Hashemi." },
      { role: "user", content: "yes" },
    ]), false);
    assert.equal(cardAwaitingYes([
      { role: "assistant", content: confirm },
      { role: "user", content: "yes" },
      { role: "assistant", content: "Sorry, something went wrong — please try again. Add the email address you send from in Settings." },
      { role: "user", content: "yes" },
    ]), true);
  });

  it("treats look at and book zoom as a booking with the day and the contact", () => {
    const look = "look at Zoom meeting with Masoud Zangeneh for tomorrow at 8:00 p.m.";
    assert.equal(isZoomAsk(look), true);
    assert.equal(tidyHeard(look).toLowerCase().startsWith("book a zoom"), true);
    assert.equal(contactPhrase(look), "Masoud Zangeneh");
    assert.equal(contactPhrase("book zoom with Masoud Zangeneh tomorrow at 8 pm"), "Masoud Zangeneh");
  });

  it("keeps a contact who has the same name as the advisor", () => {
    const hit = resolveSpokenContact("send a thank you card to Masoud Zangeneh", [{ id: 1, name: "Masoud Zangeneh" }]);
    assert.equal(hit.kind, "one");
    if (hit.kind === "one") assert.equal(hit.name, "Masoud Zangeneh");
  });

  it("matches spoken card names to the advisor's real titles", () => {
    const thankYou = matchCardByName("send a thank you card to Majid Hashemi", liveCards);
    assert.ok(thankYou && "card" in thankYou);
    if (thankYou && "card" in thankYou) assert.equal(thankYou.card.title, "Thank You...");
    for (const answer of ["Thank You", "Thank You...", "thank you card"]) {
      const picked = matchCardByName(answer, liveCards);
      assert.ok(picked && "card" in picked, answer);
      if (picked && "card" in picked) assert.equal(picked.card.title, "Thank You...");
    }
    const birthday = matchCardByName("Happy Birthday! 🎂", liveCards);
    assert.ok(birthday && "card" in birthday && birthday.card.title === "Happy Birthday! 🎂");
    const halloween = matchCardByName("halloween", liveCards);
    assert.ok(halloween && "card" in halloween && halloween.card.title === "Halloween");
    const holidays = matchCardByName("happy holidays", liveCards);
    assert.ok(holidays && "card" in holidays && holidays.card.title === "Happy Holidays! 🎁");
    assert.equal(matchCardByName("send ecard to Majid Hashemi", liveCards), undefined);
  });

  it("searches a contact by first and last name in either order", () => {
    const rows = [
      { fullName: "Hashemi, Majid", email: "majid@example.com", phone: "", tags: [] },
      { fullName: "Majid\u00a0Hashemi", email: "", phone: "(416) 555-0100", tags: ["Life Insurance Client"] },
      { fullName: "Sara Karimi", email: "sara@example.com", tags: [] },
    ];
    assert.equal(rows.filter((row) => contactMatchesQuery(row, "Majid Hashemi")).length, 2);
    assert.equal(rows.filter((row) => contactMatchesQuery(row, "majid hashemi")).length, 2);
    assert.equal(contactMatchesQuery(rows[2], "Majid Hashemi"), false);
  });

  it("writes the confirmation and the website button for the live thank-you card", () => {
    const picked = matchCardByName("send a thank you card to Majid Hashemi", liveCards);
    assert.ok(picked && "card" in picked);
    const title = picked && "card" in picked ? picked.card.title : "";
    const first = cardConfirmLine(title, "Majid Hashemi");
    assert.equal(first, "Just to confirm: send the Thank You... e-card to Majid Hashemi?");
    const follow = matchCardByName("Thank You", liveCards);
    const followTitle = follow && "card" in follow ? follow.card.title : "";
    const second = cardConfirmLine(followTitle, "Majid Hashemi");
    assert.equal(second, first);
    assert.equal(cardSentLine("Thank You...", ["Majid Hashemi"]), "Sent — the Thank You... e-card is on its way to Majid Hashemi.");
    const site = "https://youradviser.grok.me/a/masoud-zangeneh/site";
    const html = cardHtml("Dear Majid Hashemi,\n\nThank you.", "", `Masoud Zangeneh\n${site}`);
    const button = websiteButtonHtml(site);
    assert.match(html, new RegExp(site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(html.includes(button), true);
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), /https?:\/\//);
  });

  it("builds a three-article newsletter for two named people, including a misspelled send", () => {
    const line = "create a newsletter with 3 articles about life insurance importance, RRSP deadline approaching and Disability insurance and seznd it to Masoud zangeneh and Ali Mortazavi";
    assert.equal(isNewsletterAsk(line), true);
    assert.deepEqual(newsletterTopics(line), ["life insurance importance", "RRSP deadline approaching", "Disability insurance"]);
    assert.deepEqual(newsletterRecipients(line), ["Masoud zangeneh", "Ali Mortazavi"]);
    const title = newsletterTitle(newsletterTopics(line));
    assert.match(title, /Life Insurance Importance/);
    assert.match(title, /Disability Insurance/);
    for (const topic of newsletterTopics(line)) {
      const article = newsletterArticle(topic);
      assert.ok(article.body.split(/\s+/).length >= 40, topic);
    }
    const confirm = newsletterConfirmLine(title, ["Masoud Zangeneh", "Ali Mortazavi"]);
    assert.match(confirm, /Just to confirm: send the newsletter/);
    assert.equal(newsletterAwaitingYes([
      { role: "user", content: line },
      { role: "assistant", content: confirm },
      { role: "user", content: "yes" },
    ]), true);
    assert.equal(agreesToSendCard("yes"), true);
    assert.equal(newsletterAwaitingYes([
      { role: "assistant", content: confirm },
      { role: "user", content: "yes" },
      { role: "assistant", content: "Sent — the newsletter “Notes” is on its way to Masoud Zangeneh and Ali Mortazavi." },
      { role: "user", content: "yes" },
    ]), false);
  });

  it("covers the secretary tasks, including a contact file and a campaign", () => {
    assert.equal(SECRETARY_RULES.length >= 8, true);
    assert.equal(new Set(SECRETARY_RULES.map((rule) => rule.category)).size >= 6, true);
    assert.equal(taskOn(SECRETARY_RULES, "cards"), true);
    assert.equal(taskOn(SECRETARY_RULES.map((rule) => rule.id === "inbox" ? { ...rule, on: false } : rule), "inbox"), false);
    assert.equal(isEletterAsk("send an e-letter about disability insurance to Ali Mortazavi"), true);
    assert.equal(isCampaignAsk("run the welcome drip campaign to Majid Hashemi every week"), true);
    assert.equal(isInboxAsk("read my emails"), true);
    assert.equal(isReviewAsk("who needs KYC and a cross-sell review"), true);
    assert.equal(isFileAsk("what products does Majid Hashemi have"), true);
    assert.equal(fileSubject("what products does Majid Hashemi have"), "Majid Hashemi");
    assert.equal(fileSubject("what products Majid Hashemi has"), "Majid Hashemi");
    assert.equal(isEletterAsk("write a note to Ali Mortazavi about disability insurance"), true);
    assert.deepEqual(newsletterRecipients("write a note to Ali Mortazavi about disability insurance"), ["Ali Mortazavi"]);
    assert.deepEqual(newsletterTopics("write a note to Ali Mortazavi about disability insurance"), ["disability insurance"]);
    assert.deepEqual(campaignAudience("run the welcome drip campaign for life insurance clients every week"), { names: [], tag: "life insurance clients" });
    const several = "Read my emails, tell me what products Majid Hashemi has, and create a newsletter about life insurance importance and send it to Ali Mortazavi";
    const parts = splitSecretaryTasks(several);
    assert.deepEqual(parts.map((part) => taskKind(part)), ["inbox", "file", "newsletter"]);
    assert.equal(fileSubject(parts[1]), "Majid Hashemi");
    assert.deepEqual(newsletterRecipients(parts[2]), ["Ali Mortazavi"]);
    const oneNewsletter = "create a newsletter with 3 articles about life insurance importance, RRSP deadline approaching and Disability insurance and seznd it to Masoud zangeneh and Ali Mortazavi";
    assert.equal(splitSecretaryTasks(oneNewsletter).length, 1);
    assert.equal(isReviewAsk("who needs KYC and a cross-sell review"), true);
    assert.equal(splitSecretaryTasks("who needs KYC and a cross-sell review").length, 1);
    assert.equal(eletterAwaitingYes([{ role: "assistant", content: "Just to confirm: send the e-letter “Disability Insurance” to Ali Mortazavi?" }]), true);
    assert.equal(campaignAwaitingYes([{ role: "assistant", content: "Just to confirm: start the Welcome campaign, every week, for Majid Hashemi?" }]), true);
    const batch = [
      { role: "assistant", content: "Latest inbox mail:\n- Sam: Hello\n\nJust to confirm: send the newsletter “Notes” to Ali Mortazavi?\nJust to confirm: send the e-letter “Disability Insurance” to Majid Hashemi?\nSay yes and I will send all of these." },
    ];
    assert.equal(batchAwaitingYes(batch), true);
    assert.equal(newsletterAwaitingYes(batch), true);
    assert.equal(eletterAwaitingYes(batch), true);
    assert.equal(batchAwaitingYes([
      ...batch,
      { role: "user", content: "yes" },
      { role: "assistant", content: "Sent — the newsletter “Notes” is on its way to Ali Mortazavi.\nSent — the e-letter “Disability Insurance” is on its way to Majid Hashemi." },
    ]), false);
    const phone = "4165550100";
    const email = "hello@firm.com";
    const site = "https://youradviser.grok.me/a/masoud-zangeneh/site";
    assert.equal(websiteHref(phone), "");
    assert.equal(websiteHref(email), "");
    assert.equal(isWebsiteLine(phone), false);
    assert.equal(isWebsiteLine(email), false);
    assert.equal(websiteHref(site).startsWith("https://"), true);
    const stacked = cardHtml("Dear Majid Hashemi,\n\nThank you.", "", ["Masoud Zangeneh", phone, email, site].join("\n"));
    assert.equal((stacked.match(/Visit my website/g) || []).length, 1);
    assert.match(stacked, /4165550100/);
    assert.match(stacked, /hello@firm\.com/);
  });

  it("reads the calendar without treating a booking as a calendar lookup", () => {
    assert.equal(isCalendarAsk("show my calendar"), true);
    assert.equal(isCalendarAsk("show about calendar"), true);
    assert.equal(isCalendarAsk("what's on my schedule"), true);
    assert.equal(taskKind("show my calendar"), "calendar");
    assert.equal(isCalendarAsk("book a zoom meeting with Majid Hashemi tomorrow at 8 pm"), false);
    assert.equal(isCalendarAsk("send a thank you card to Majid Hashemi"), false);
  });

  it("treats season's greeting and thank you as e-cards, and asks when unsure", () => {
    for (const line of ["send seasons greeting", "send season's greetings", "seasonal greeting", "send thank you", "thank you", "thanks to Majid Hashemi"]) {
      assert.equal(isCardAsk(line), true, line);
    }
    assert.equal(isCardAsk("send a thank you letter to Ali about the review"), false);
    assert.equal(isEletterAsk("send a thank you letter to Ali about the review"), true);
    assert.equal(contactPhrase("send seasons greeting to Majid Hashemi"), "Majid Hashemi");
    assert.equal(contactPhrase("send thank you to Ali Mortazavi"), "Ali Mortazavi");
    const season = matchCardByName("send seasons greeting to Majid Hashemi", liveCards);
    assert.ok(season && "card" in season);
    if (season && "card" in season) assert.equal(season.card.title, "Season's Greetings");
    const thanks = matchCardByName("send thank you", liveCards);
    assert.ok(thanks && "card" in thanks);
    if (thanks && "card" in thanks) assert.equal(thanks.card.title, "Thank You...");
    const unsure = matchCardByName("send greeting", [
      { id: "season", title: "Season's Greetings" },
      { id: "holiday", title: "Holiday Greeting" },
    ]);
    assert.ok(unsure && "cards" in unsure);
    if (unsure && "cards" in unsure) {
      assert.equal(cardDoubtLine(unsure.cards.map((card) => card.title), "Majid Hashemi"), "Did you mean the Holiday Greeting card or the Season's Greetings card for Majid Hashemi?");
    }
    assert.equal(taskKind("send seasons greeting to Majid Hashemi"), "e-card");
    const rule = [{ on: true, text: "When I say green note or morning wave, treat it as an e-card." }];
    assert.deepEqual(ruleCardPhrases(rule), ["green note", "morning wave"]);
    assert.equal(textHitsRuleCard("send a green note to Majid", rule), true);
    const heard = parseHeardJob('Sure. {"job":"card","card":"Season\'s Greetings","contact":"Majid Hashemi","rewrite":"send the Season\'s Greetings e-card to Majid Hashemi","unsure":false,"ask":""}');
    assert.equal(heard?.job, "card");
    assert.equal(heard ? heardCommand(heard) : "", "send the Season's Greetings e-card to Majid Hashemi");
    const doubt = parseHeardJob('{"job":"card","card":"","contact":"Majid","rewrite":"send a card","unsure":true,"ask":"Did you mean the Season\'s Greetings card?"}');
    assert.equal(doubt ? heardCommand(doubt) : "x", "");
    assert.equal(doubt?.ask, "Did you mean the Season's Greetings card?");
  });

  it("creates a newsletter and removes one part by number or by name", () => {
    const line = "create a newsletter about life insurance, RRSP deadline and disability insurance for Ali Mortazavi";
    assert.equal(isNewsletterAsk(line), true);
    assert.deepEqual(newsletterTopics(line), ["life insurance", "RRSP deadline", "disability insurance"]);
    assert.deepEqual(newsletterRecipients(line), ["Ali Mortazavi"]);
    const titles = ["Life Insurance", "RRSP Deadline", "Disability Insurance"];
    assert.equal(isNewsletterEdit("remove this part from the newsletter"), true);
    assert.equal(isNewsletterAsk("remove this part from the newsletter"), false);
    assert.equal(newsletterDropIndex("remove this part from the newsletter", titles), "ask");
    assert.equal(newsletterDropIndex("remove 2", titles), 1);
    assert.equal(newsletterDropIndex("remove the RRSP part", titles), 1);
    assert.equal(newsletterDropIndex("the last part", titles, true), 2);
    assert.match(newsletterReadyLine("Notes", ["Ali Mortazavi"], titles), /1\. Life Insurance/);
    assert.match(newsletterReadyLine("Notes", ["Ali Mortazavi"], titles), /Just to confirm: send the newsletter/);
  });

  it("lets Grok hear a real request and keeps yes, no, and a card choice on the desk", () => {
    assert.equal(deskKeepsTurn("yes", "Just to confirm: send the Thank You... e-card to Majid Hashemi?"), true);
    assert.equal(deskKeepsTurn("no", "Just to confirm: send the newsletter “Notes” to Ali Mortazavi?"), true);
    assert.equal(deskKeepsTurn("send seasons greeting to Majid Hashemi", ""), false);
    assert.equal(deskKeepsTurn("thank you", ""), false);
    assert.equal(deskKeepsTurn("Season's Greetings", "Did you mean the Season's Greetings card or the Holiday Greeting card?"), true);
    assert.equal(deskKeepsTurn("remove the RRSP part from the newsletter", ""), true);
    const yesRewrite = parseHeardJob('{"job":"card","card":"Thank You...","contact":"Majid","rewrite":"yes","unsure":false,"ask":""}');
    assert.equal(yesRewrite ? heardCommand(yesRewrite) : "x", "");
    const heard = parseHeardJob('{"job":"card","card":"Season\'s Greetings","contact":"Majid Hashemi","rewrite":"send the Season\'s Greetings e-card to Majid Hashemi","unsure":false,"ask":""}');
    assert.equal(heard ? heardCommand(heard) : "", "send the Season's Greetings e-card to Majid Hashemi");
    const doubt = parseHeardJob('{"job":"card","card":"","contact":"","rewrite":"","unsure":true,"ask":"Season\'s Greetings"}');
    assert.equal(doubt ? grokDoubtReply(doubt) : "", "Did you mean the Season's Greetings card?");
  });

  it("keeps a letter as a letter and treats a review as a client check", () => {
    const line = "write a letter to majid hashemi and tell him its time to review your policy and suggest some time for a zoom or in person meeting";
    assert.equal(isEletterAsk(line), true);
    assert.equal(isCardAsk(line), false);
    assert.equal(taskKind(line), "e-letter");
    assert.equal(eletterRecipient(line).toLowerCase(), "majid hashemi");
    const letter = eletterFromRequest(line);
    assert.ok(letter);
    assert.match(letter?.body || "", /review your policy/i);
    assert.match(letter?.body || "", /Zoom meeting/i);
    assert.match(letter?.body || "", /in-person/i);
    assert.match(letter?.body || "", /Book a meeting button/i);
    const ask = "send a letter to ali mortazavi ask for a meeting to review your policies";
    assert.equal(isEletterAsk(ask), true);
    assert.equal(eletterRecipient(ask).toLowerCase(), "ali mortazavi");
    const asked = eletterFromRequest(ask);
    assert.ok(asked);
    assert.match(asked?.body || "", /meeting to review your policies/i);
    assert.match(asked?.body || "", /Book a meeting button/i);
    assert.doesNotMatch(asked?.body || "", /What should the letter say/i);
    assert.match(letter?.body || "", /Zoom or in person/i);
    assert.equal(isReviewAsk("which client need review"), true);
    assert.equal(isReviewAsk("who is due to contact"), true);
    assert.equal(taskKind("which clients need a review"), "review");
    assert.equal(isCardAsk("which client need review"), false);
    assert.equal(rewriteAllowed(line, "send the Thank You card to Majid Hashemi"), false);
    assert.equal(cardDoubtAllowed(line, "card"), false);
    assert.equal(cardDoubtAllowed("send a thank you card to Majid", "card"), true);
  });

  it("treats the fictional onboarding command as a draft, not a contact search", () => {
    const line = "Demonstrate onboarding with fictional client Alex Example. Prepare an intake request and checklist using placeholder details. Do not search contacts, save records, send messages, or schedule anything.";
    assert.equal(isOnboardingDemo(line), true);
    assert.equal(taskKind(line), "onboarding");
    assert.equal(isFileAsk(line), false);
    assert.equal(isCardAsk(line), false);
    assert.equal(isEletterAsk(line), false);
    assert.equal(contactPhrase(line), "Alex Example");
    assert.equal(contactPhrase("onboarding with Using fictional test contacts. Do not search contacts."), "");
    assert.equal(looksLikeInstruction("Using fictional test"), true);
    assert.equal(fileSubject(line), "Alex Example");
    assert.equal(rewriteAllowed(line, "open the file for Using fictional test"), false);
    const draft = onboardingDraft(line);
    assert.match(draft, /Alex Example/);
    assert.match(draft, /Intake request/);
    assert.match(draft, /Checklist/);
    assert.match(draft, /Nothing was searched, saved, sent, or scheduled/);
    assert.doesNotMatch(draft, /could not find/i);
    assert.doesNotMatch(draft, /Using fictional test/);
  });

  it("revises a draft instead of treating the follow-up as yes or no", () => {
    const command = "Demonstrate onboarding with fictional client Alex Example. Prepare an intake request and checklist using placeholder details. Do not search contacts, save records, send messages, or schedule anything.";
    const follow = "Please rewrite that email under 100 words, change the tone, and add a request for a 20-minute introductory meeting, without searching, saving, sending, or scheduling.";
    const draft = onboardingDraft(command);
    assert.equal(isRevisionAsk(follow), true);
    assert.equal(deskKeepsTurn(follow, draft), false);
    assert.equal(yesApplies(follow, draft), false);
    assert.equal(showUnclearChoice(follow, draft, draft), false);
    const revised = revisionOf(draft, follow);
    const email = revised.split("\n").filter((line) => line && !/^(Revised draft|Nothing was searched|The earlier approval|The meeting was not)/.test(line)).join(" ");
    assert.ok(email.split(/\s+/).length <= 100, email);
    assert.match(revised, /20-minute introductory meeting/);
    assert.match(revised, /Nothing was searched, saved, sent, or scheduled/);
    assert.doesNotMatch(revised, /approval no longer applies/);
    assert.doesNotMatch(revised, /The meeting was not scheduled/);
    assert.notEqual(revised, draft);
    assert.doesNotMatch(revised, /could not find|Choose one/i);
    const messages = revisionMessages(draft, follow, [
      { role: "user", content: command },
      { role: "assistant", content: draft },
    ]);
    assert.match(messages.map((item) => item.content).join("\n"), /Alex Example/);
    assert.match(messages.at(-1)?.content || "", /Current draft:/);
    const confirm = "Just to confirm: send the Thank You e-card to Alex Example?";
    assert.equal(yesApplies("yes", confirm), true);
    assert.equal(shouldIgnorePending("cancel", confirm), true);
    assert.equal(shouldIgnorePending("send a thank you card to Sam North", confirm), true);
    assert.equal(shouldIgnorePending("yes", confirm), false);
    assert.equal(pendingQuestion(draft), "draft");
    assert.equal(yesApplies("yes", draft), false);
  });

  it("revises a checklist through sections, a shorter draft, and Farsi", () => {
    const create = "Draft a preparation checklist for it. Do not save or send anything.";
    const checklist = [
      "Preparation checklist for Alex Example review at 9:00 AM:",
      "- Confirm the time shown on the calendar",
      "- Review the appointment title and where it is listed",
      "- Note any documents the advisor still needs to bring",
      "- Leave signatures and advice for the advisor",
      "Nothing was saved or sent. No contact was searched.",
    ].join("\n");
    const reorganize = "Separate Known details from Information needed. Include location, purpose, documents, and follow-ups. Mark unavailable information as unknown. Do not search, save, send, or change records.";
    assert.equal(isRevisionAsk(create), false);
    assert.equal(isRevisionAsk(reorganize), true);
    const sections = revisionOf(checklist, reorganize);
    assert.match(sections, /Known details/);
    assert.match(sections, /Information needed/);
    assert.match(sections, /Appointment: Alex Example review/);
    assert.match(sections, /Time: 9:00 AM/);
    assert.match(sections, /Location: Unknown/);
    assert.match(sections, /Purpose: Unknown/);
    assert.match(sections, /Documents: Unknown/);
    assert.match(sections, /Follow-ups: Unknown/);
    assert.match(sections, /Nothing was searched, saved, sent, or changed/);
    assert.doesNotMatch(sections, /Street|Avenue|Road/);
    assert.equal(revisionFollows(checklist, reorganize, checklist), false);
    assert.equal(revisionFollows(checklist, reorganize, sections), true);
    const shorten = "Shorten that checklist. Do not save or send.";
    const short = revisionOf(sections, shorten);
    assert.ok(short.split(/\s+/).length < sections.split(/\s+/).length, short);
    assert.match(short, /Known details/);
    assert.match(short, /Information needed/);
    assert.match(short, /unknown/i);
    assert.match(short, /Alex Example review/);
    const translate = "Translate it into Farsi. Do not save or send.";
    const farsi = revisionOf(short, translate);
    assert.match(farsi, /جزئیات مشخص/);
    assert.match(farsi, /اطلاعات مورد نیاز/);
    assert.match(farsi, /نامشخص/);
    assert.match(farsi, /Alex Example review/);
    assert.doesNotMatch(farsi, /Street|Avenue/);
    const messages = revisionMessages(sections, shorten, [
      { role: "assistant", content: checklist },
      { role: "user", content: reorganize },
      { role: "assistant", content: sections },
    ]);
    assert.match(messages.at(-1)?.content || "", /Current draft:/);
    assert.match(messages.at(-1)?.content || "", /Latest instruction:/);
    assert.match(messages.at(-1)?.content || "", /Shorten that checklist/);
    assert.match(messages.map((item) => item.content).join("\n"), /Alex Example review/);
  });

  it("leaves a translated checklist and drafts a new English email", () => {
    const farsi = revisionOf("Preparation checklist for Alex Example review at 9:00 AM:\n- Confirm the time", "Translate it into Farsi. Do not save or send.");
    const next = "Leave the appointment checklist. Draft a warm welcome email in English for fictional client Jordan Example, under 80 words. Invite Jordan to arrange a 20-minute introductory call, without proposing a specific time. Do not search contacts, save, send, or book anything.";
    assert.equal(isRevisionAsk(next), false);
    assert.equal(isTaskSwitch(next), true);
    assert.equal(isStandaloneDraft(next), true);
    assert.equal(isEletterAsk(next), false);
    assert.equal(isCardAsk(next), false);
    const email = freshDraft(next);
    assert.equal(revisionOf(farsi, next), email);
    assert.match(email, /Hello Jordan Example/);
    assert.match(email, /20-minute introductory call/);
    assert.match(email, /not proposing a specific time/);
    assert.match(email, /No contact was looked up/);
    assert.match(email, /no record was deleted/i);
    assert.doesNotMatch(email, /[\u0600-\u06FF]/);
    assert.doesNotMatch(email, /\d{1,2}:\d{2}\s*[AP]M/i);
    const hello = email.split("\n").find((line) => line.startsWith("Hello")) || "";
    assert.ok(hello.split(/\s+/).length <= 80, hello);
    const revised = revisionOf(email, "Revise that email. Do not search, save, send, or book anything.");
    assert.match(revised, /Jordan Example/);
    assert.match(revised, /pleasure to welcome you|look forward/i);
    assert.doesNotMatch(revised, /[\u0600-\u06FF]/);
    assert.doesNotMatch(revised, /could not find/i);
    const unrelated = "Cancel that email and draft an unrelated checklist. Do not search contacts, save, send, or book anything.";
    assert.equal(isTaskSwitch(unrelated), true);
    assert.equal(isRevisionAsk(unrelated), false);
    const checklist = freshDraft(unrelated);
    assert.match(checklist, /new checklist/i);
    assert.match(checklist, /Unknown/);
    assert.match(checklist, /No pending action was sent/);
    assert.doesNotMatch(checklist, /Alex Example|9:00|could not find/i);
  });

  it("rewrites an email without keeping removed text or inventing an approval", () => {
    const previous = [
      "Welcome email draft",
      "Hello Jordan Example, it is a pleasure to welcome you. I am glad you are here. When you are ready, we can arrange a 20-minute introductory call. I am not proposing a specific time. Please reply when you would like to take the next step.",
    ].join("\n");
    const instruction = "Rewrite that email naturally and warmly, under 60 words. Remove 'I am not proposing a specific time' and invite Jordan to suggest a convenient time for a 20-minute introductory call. Show only the subject and email body. Keep it as a draft; do not send or save it.";
    assert.equal(isRevisionAsk(instruction), true);
    assert.equal(isTaskSwitch(instruction), false);
    const revised = revisionOf(previous, instruction);
    assert.match(revised, /^Subject:/);
    assert.match(revised, /Hello Jordan Example/);
    assert.match(revised, /suggest a convenient time/i);
    assert.match(revised, /20-minute/);
    assert.ok(revised.split(/\s+/).filter(Boolean).length < 60, revised);
    assert.doesNotMatch(revised, /not proposing a specific time/i);
    assert.doesNotMatch(revised, /approval|scheduled|Nothing was searched|Revised draft/i);
    const messages = revisionMessages(previous, instruction, [
      { role: "assistant", content: previous },
    ]);
    assert.match(messages.at(-1)?.content || "", /Current draft:/);
    assert.match(messages.at(-1)?.content || "", /I am not proposing a specific time/);
    assert.match(messages.at(-1)?.content || "", /Latest instruction:/);
    assert.equal(revisionFollows(previous, instruction, previous), false);
    assert.equal(revisionFollows(previous, instruction, revised), true);
    const confirmed = `Just to confirm: send the Welcome e-card to Jordan Example?\n${previous}`;
    const afterConfirm = revisionOf(confirmed, "Rewrite that email under 40 words. Do not send it.");
    assert.match(afterConfirm, /approval no longer applies/);
  });

  it("lets the latest request choose the task across several wordings", () => {
    const leaveEmail = "Leave that email as an unsent draft. Give me three bullet points for organizing tomorrow’s workload. Answer in English. Do not search, save, send, or schedule anything.";
    const priorities = "Set the letter aside. What should I tackle first tomorrow? Give me three priorities. Do not save or send.";
    const morning = "Forget the draft. List the morning work in four bullets. Answer in English.";
    const farsiPlan = "Leave the note. سه مورد نمی‌خواهم. Give me three priorities for tomorrow in Farsi. Do not save anything.";
    const rewrite = "Rewrite that email naturally and warmly, under 60 words. Show only the subject and email body.";
    const compose = "Leave the appointment checklist. Draft a warm welcome email in English for fictional client Mina Sample. Do not search or save.";
    const checklist = "Draft a preparation checklist for it. Do not save or send anything.";
    for (const line of [leaveEmail, priorities, morning]) {
      assert.equal(asksForPlan(line), true, line);
      assert.equal(asksToComposeEmail(line), false, line);
      assert.equal(isRevisionAsk(line), false, line);
      const plan = workloadPlan(line);
      assert.match(plan, /^- /m);
      assert.doesNotMatch(plan, /Hello|Subject:|the client/i);
    }
    assert.equal((workloadPlan(leaveEmail).match(/^- /gm) || []).length, 3);
    assert.equal((workloadPlan(morning).match(/^- /gm) || []).length, 4);
    assert.match(workloadPlan(farsiPlan), /برنامه کار/);
    assert.doesNotMatch(workloadPlan(farsiPlan), /Hello/);
    assert.equal(asksForPlan(rewrite), false);
    assert.equal(isRevisionAsk(rewrite), true);
    assert.equal(asksToComposeEmail(compose), true);
    assert.equal(asksForPlan(compose), false);
    assert.match(freshDraft(compose), /Hello Mina Sample/);
    assert.equal(asksForPlan(checklist), false);
    assert.equal(asksToComposeEmail(checklist), false);
    const thread = [
      { role: "assistant", content: "Subject: Welcome\n\nHello Mina Sample, welcome." },
      { role: "assistant", content: "Workload for tomorrow\n- Check the calendar for tomorrow before adding anything new." },
    ];
    const resumed = earlierDraftReply("Please show the earlier email again. Do not send or save it.", thread);
    assert.match(resumed, /Hello Mina Sample/);
    assert.match(resumed, /Nothing was saved or sent/);
    assert.equal(asksToResume("Please show the earlier email again. Do not send or save it."), true);
    assert.equal(asksToResume("Bring back the checklist."), true);
    const confirm = "Just to confirm: send the Thank You e-card to Mina Sample?";
    assert.equal(yesApplies("yes", confirm), true);
    assert.equal(asksForPlan("Cancel the pending card and then list three priorities for tomorrow. Do not send anything."), true);
    assert.equal(yesApplies("Cancel the pending card and then list three priorities for tomorrow. Do not send anything.", confirm), false);
  });

  it("routes one current instruction and does not let a prohibition open a lookup", () => {
    const previous = [
      "Workload for tomorrow",
      "- Check the calendar for tomorrow before adding anything new.",
      "- Decide which follow-ups are waiting on you.",
      "- Group the drafts that still need a decision.",
    ].join("\n");
    const edit = "Replace the second bullet with 'Review outstanding client documents.' Show only the three updated bullets. Do not search, save, send, or schedule anything.";
    const changed = "Change the first line to 'Call the carrier before noon.'";
    assert.equal(decideTurn(edit, previous), "edit");
    assert.equal(isCalendarAsk(edit), false);
    assert.equal(isCalendarAsk(previous), true);
    assert.equal(toolsAllowed(edit), false);
    assert.equal(decideTurn("Show my appointments for today"), "calendar");
    assert.equal(toolsAllowed("Show my appointments for today"), true);
    const bullets = editListedText(previous, edit);
    assert.equal(bullets, [
      "- Check the calendar for tomorrow before adding anything new.",
      "- Review outstanding client documents.",
      "- Group the drafts that still need a decision.",
    ].join("\n"));
    assert.doesNotMatch(bullets, /two weeks|Appointments for|Hello /);
    assert.match(editListedText(previous, changed), /^- Call the carrier before noon\./);
    const confirm = "Just to confirm: send the Thank You e-card to Mina Sample?";
    assert.equal(decideTurn("yes", confirm), "confirm");
    assert.equal(decideTurn(edit, confirm), "edit");
    assert.equal(yesApplies(edit, confirm), false);
  });
});
