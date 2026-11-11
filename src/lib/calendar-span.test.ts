import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerAboutAppointment, calendarListingFromThread, calendarSpan, isCalendarSummary, presentCalendar, refersToAppointment, summarizeListedAppointments } from "./calendar-span.ts";
import { contactPhrase, fileSubject, isCalendarAsk, taskKind, textHitsRuleCard } from "./advisor-intent.ts";
import { nameQuestion, resolveSpokenContact } from "./contact-match.ts";

describe("calendar range", () => {
  it("shows today only, merges the linked meeting, and keeps a separate event at the same time", () => {
    const now = new Date("2026-11-11T13:00:00.000Z");
    const ask = "Show my appointments for today";
    assert.equal(isCalendarAsk(ask), true);
    assert.equal(taskKind(ask), "calendar");
    const span = calendarSpan(ask, now, "America/Toronto");
    assert.equal(span.start, "2026-11-11T05:00:00.000Z");
    assert.equal(span.end, "2026-11-12T05:00:00.000Z");
    assert.match(span.label, /^today, Wednesday, November 11, 2026$/);
    const listing = presentCalendar(span, [
      { source: "Zoom", id: "88", title: "Group workshop", start: "2026-11-11T16:00:00.000Z" },
      { source: "Outlook", id: "AA", title: "Policy review", start: "2026-11-11T14:00:00.000Z", join: "https://zoom.us/j/1" },
      { source: "Outlook", id: "AA", title: "Policy review", start: "2026-11-11T14:00:00.000Z", join: "https://zoom.us/j/1" },
      { source: "Zoom", id: "99", title: "Policy review", start: "2026-11-11T14:00:00.000Z", join: "https://zoom.us/j/1" },
      { source: "Outlook", id: "BB", title: "New client", start: "2026-11-11T16:00:00.000Z" },
      { source: "Outlook", id: "CC", title: "Tomorrow only", start: "2026-11-12T15:00:00.000Z" },
    ]);
    assert.match(listing, /Appointments for today, Wednesday, November 11, 2026/);
    assert.doesNotMatch(listing, /two weeks|Tomorrow only/);
    assert.match(listing, /Range: 2026-11-11T05:00:00.000Z to 2026-11-12T05:00:00.000Z \(America\/Toronto\)/);
    const lines = listing.split("\n").filter((line) => line.startsWith("- "));
    assert.deepEqual(lines, [
      "- 9:00 AM: Policy review (Outlook and Zoom)",
      "- 11:00 AM: Group workshop (Zoom)",
      "- 11:00 AM: New client (Outlook)",
    ]);
    const follow = "Summarize those appointments in one sentence";
    assert.equal(isCalendarSummary(follow), true);
    assert.equal(isCalendarAsk(follow), false);
    const summary = summarizeListedAppointments(listing);
    assert.equal(summary, "Today, Wednesday, November 11, 2026 includes Policy review at 9:00 AM, Group workshop at 11:00 AM, and New client at 11:00 AM.");
    assert.equal(summary.split("Policy review").length - 1, 1);
    assert.doesNotMatch(summary, /Tomorrow|two weeks/);
  });

  it("answers a follow-up from the one appointment and does not treat the question as a contact", () => {
    const now = new Date("2026-11-11T13:00:00.000Z");
    const listing = presentCalendar(calendarSpan("Show my appointments for today", now, "America/Toronto"), [
      { source: "Outlook", id: "AA", title: "Policy review", start: "2026-11-11T14:00:00.000Z" },
    ]);
    const time = "What time is it?";
    const who = "Who is it with?";
    const summary = "Summarize that appointment.";
    const checklist = "Draft a preparation checklist for it. Do not save or send anything.";
    for (const follow of [time, who, summary, checklist]) {
      assert.equal(refersToAppointment(follow), true, follow);
      assert.equal(contactPhrase(follow), "", follow);
    }
    assert.equal(contactPhrase("What time is that appointment, and who is it with? Answer in one sentence without changing anything."), "");
    assert.equal(textHitsRuleCard("What time is that appointment, and who is it with?", [{ text: "When I say time, treat it as an e-card.", on: true }]), false);
    assert.equal(answerAboutAppointment(time, listing), "That appointment is at 9:00 AM.");
    assert.equal(answerAboutAppointment(who, listing), "That appointment is listed as Policy review.");
    assert.equal(answerAboutAppointment(summary, listing), "Policy review is at 9:00 AM (Outlook).");
    const draft = answerAboutAppointment(checklist, listing);
    assert.match(draft, /Preparation checklist for Policy review at 9:00 AM/);
    assert.match(draft, /Nothing was saved or sent/);
    assert.doesNotMatch(draft, /could not find|contacts/i);
    assert.equal(contactPhrase("send a thank you card to Majid Hashemi"), "Majid Hashemi");
    assert.equal(fileSubject("what products does Majid Hashemi have"), "Majid Hashemi");
    const many = presentCalendar(calendarSpan("Show my appointments for today", now, "America/Toronto"), [
      { source: "Outlook", id: "AA", title: "Policy review", start: "2026-11-11T14:00:00.000Z" },
      { source: "Zoom", id: "BB", title: "Group workshop", start: "2026-11-11T16:00:00.000Z" },
    ]);
    assert.match(answerAboutAppointment("What time is it?", many), /Which appointment\?/);
    assert.equal(nameQuestion(["Sam North", "Sam Norton"]), "Did you mean Sam North or Sam Norton?");
    const ambiguous = resolveSpokenContact("send the card to Sam Nort", [
      { id: 1, name: "Sam North" },
      { id: 2, name: "Sam Norton" },
    ]);
    assert.ok(ambiguous.kind === "many" || ambiguous.kind === "ask");
    assert.match("question" in ambiguous ? ambiguous.question : "", /Sam North|contact/i);
    const older = "Calendar for the next two weeks:\n- Wed, Nov 11, 9:00 AM: Alex Example review (Outlook)\n";
    const thread = [
      { role: "assistant", content: older },
      { role: "user", content: "Who is it with?" },
      { role: "assistant", content: "That appointment is listed as Alex Example review." },
    ];
    const kept = calendarListingFromThread(thread);
    assert.match(kept, /Calendar for the next two weeks/);
    assert.equal(answerAboutAppointment("What time is it?", kept), "That appointment is at Wed, Nov 11, 9:00 AM.");
  });
});
