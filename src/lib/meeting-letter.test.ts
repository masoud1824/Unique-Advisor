import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMeetingLetter } from "./meeting-letter.ts";
import { shownWebsite, useCurrentWebsite, cardHtml, signatureWithWebsite, websiteButtonText } from "./advisor-website.ts";
import { renderEletter } from "./eletter.ts";
import { emptySocial, renderNewsletter, signatureLines } from "./newsletter.ts";

const join = "https://zoom.us/j/123456789?pwd=ab&uname=a";

function letterFor(clientName: string, audience: "client" | "advisor" = "client", kind: "confirm" | "reminder" | "cancel" = "confirm") {
  return buildMeetingLetter({
    kind,
    audience,
    clientName,
    advisorName: "Masoud Zangeneh",
    advisorTitle: "Financial Advisor",
    advisorPhone: "647-000-0000",
    advisorEmail: "masoud@example.com",
    advisorCompany: "Unique Advisor",
    advisorWebsite: "https://uniqueadvisor.example",
    photoSrc: "data:image/png;base64,aaaa",
    topic: "Annual review",
    whenUtc: "2026-11-07T20:00:00.000Z",
    timeZone: "America/Toronto",
    minutes: 30,
    join,
    meetingId: "123456789",
    passcode: "246810",
    icsUrl: "https://youradviser.grok.me/api/meetings/ics?token=abc123",
    icsToken: "abc123abc123abc123abc123abc123ab",
    design: "plum",
  });
}

function visible(html: string) {
  return html.replace(/<[^>]+>/g, " ");
}

describe("meeting letters", () => {
  it("greets each client by name and keeps the Zoom link in the button only", () => {
    for (const name of ["Max Santiago", "Lina Chen"]) {
      const letter = letterFor(name);
      assert.match(letter.html, new RegExp(`Dear ${name}`));
      assert.match(letter.text, new RegExp(`Dear ${name}`));
      assert.match(letter.html, /Join Zoom Meeting/);
      assert.match(letter.html, /click here to join/);
      assert.match(letter.html, /Add to calendar/);
      assert.match(letter.html, /Meeting ID/);
      assert.match(letter.html, /123456789/);
      assert.match(letter.html, /246810/);
      assert.match(letter.html, /Saturday/);
      assert.match(letter.html, /November 7, 2026/);
      assert.match(letter.html, /3:00 PM/);
      assert.equal(letter.subject, "Zoom meeting with Masoud Zangeneh – Sat, Nov 7, 3:00 PM");
      assert.doesNotMatch(letter.subject, /Meeting confirmed/);
      assert.match(letter.html, /Eastern Time \(Toronto\)/);
      assert.doesNotMatch(letter.text, /\bEST\b/);
      assert.match(letter.html, /30 minutes/);
      assert.match(letter.html, /Warm regards/);
      assert.match(letter.html, /reply to this email/);
      assert.match(letter.html, /Unique Advisor/);
      assert.match(letter.html, /#5c1a4a/);
      assert.match(letter.html, /data:image\/png;base64,aaaa/);
      assert.match(letter.html, new RegExp(String.raw`href="https://zoom\.us/j/123456789\?pwd=ab&` + "amp;uname=a\""));
      assert.doesNotMatch(visible(letter.html), /https:\/\/zoom\.us/);
      assert.doesNotMatch(letter.text, /https:\/\/zoom\.us/);
      assert.match(letter.text, /Add to calendar: https:\/\/youradviser\.grok\.me\/api\/meetings\/ics/);
      assert.match(letter.ics, /URL:https:\/\/zoom\.us\/j\/123456789/);
    }
    const max = letterFor("Max Santiago");
    const lina = letterFor("Lina Chen");
    assert.doesNotMatch(max.text, /Lina Chen/);
    assert.doesNotMatch(lina.text, /Max Santiago/);
  });

  it("uses the same template for the advisor copy and omits the join button when cancelled", () => {
    const copy = letterFor("Max Santiago", "advisor");
    assert.match(copy.html, /Dear Masoud Zangeneh/);
    assert.match(copy.html, /Max Santiago/);
    assert.match(copy.html, /Join Zoom Meeting/);
    assert.doesNotMatch(visible(copy.html), /https:\/\/zoom\.us/);
    const cancelled = letterFor("Ann & Jo <Team>", "client", "cancel");
    assert.match(cancelled.html, new RegExp(`Dear Ann ${"&" + "amp;"} Jo ${"&" + "lt;"}Team${"&" + "gt;"}`));
    assert.doesNotMatch(cancelled.html, /<Team>/);
    assert.doesNotMatch(cancelled.html, /Join Zoom Meeting/);
    assert.doesNotMatch(cancelled.html, /click here to join/);
    assert.doesNotMatch(cancelled.text, /https:\/\/zoom\.us/);
    assert.doesNotMatch(visible(cancelled.html), /https:\/\/zoom\.us/);
    assert.match(cancelled.html, /cancelled/i);
    assert.match(cancelled.ics, /METHOD:CANCEL/);
    assert.doesNotMatch(cancelled.ics, /zoom\.us/);
  });

  it("never repeats a signature line and does not use the advisor name as the firm", () => {
    const same = signatureLines({
      name: "Masoud Zangeneh",
      title: "Financial Advisor",
      company: "Masoud Zangeneh",
      phone: "647-000-0000",
      email: "masoud@example.com",
      website: "https://uniqueadvisor.example",
    });
    assert.deepEqual(same, [
      "Masoud Zangeneh",
      "Financial Advisor",
      "647-000-0000",
      "masoud@example.com",
      "https://uniqueadvisor.example",
    ]);
    const firm = signatureLines({
      name: "Masoud Zangeneh",
      title: "Financial Advisor",
      company: "Zangeneh Law Firm",
      phone: "647-000-0000",
      email: "masoud@example.com",
      website: "https://uniqueadvisor.example",
    });
    assert.deepEqual(firm, [
      "Masoud Zangeneh",
      "Financial Advisor",
      "Zangeneh Law Firm",
      "647-000-0000",
      "masoud@example.com",
      "https://uniqueadvisor.example",
    ]);
    for (const kind of ["confirm", "reminder", "cancel"] as const) {
      const letter = buildMeetingLetter({
        kind,
        audience: "client",
        clientName: "Max Santiago",
        advisorName: "Masoud Zangeneh",
        advisorTitle: "Financial Advisor",
        advisorPhone: "647-000-0000",
        advisorEmail: "masoud@example.com",
        advisorCompany: "Masoud Zangeneh",
        advisorWebsite: "https://uniqueadvisor.example",
        topic: "Annual review",
        whenUtc: "2026-11-07T20:00:00.000Z",
        timeZone: "America/Toronto",
        minutes: 30,
        join,
        meetingId: "123456789",
        passcode: "246810",
        icsUrl: "https://youradviser.grok.me/api/meetings/ics?token=abc123",
        icsToken: "abc123abc123abc123abc123abc123ab",
        design: "plum",
      });
      const signature = letter.text.split("Warm regards,")[1]?.split("This message was sent")[0] || "";
      const lines = signature.split("\n").map((line) => line.trim()).filter(Boolean);
      const keys = lines.map((line) => line.toLowerCase());
      assert.equal(new Set(keys).size, keys.length);
      assert.equal(lines.filter((line) => line === "Masoud Zangeneh").length, 1);
      assert.ok(lines.includes("Financial Advisor"));
      assert.ok(lines.includes("(647) 000-0000"));
      assert.ok(lines.includes("masoud@example.com"));
      assert.ok(lines.some((line) => line.startsWith("Visit my website:")));
      assert.equal(lines.includes("https://uniqueadvisor.example"), false);
      assert.doesNotMatch(letter.text, /Masoud Zangeneh,\s*Masoud Zangeneh/);
      const shown = letter.html.replace(/<[^>]+>/g, " ");
      assert.equal(shown.split("This message was sent by").length - 1, 1);
      assert.equal(letter.text.split("This message was sent by").length - 1, 1);
      assert.match(letter.html, /href="https:\/\/uniqueadvisor\.example"/);
      assert.match(letter.html, /Visit my website/);
      assert.doesNotMatch(shown, /https:\/\/uniqueadvisor\.example/);
    }
    const contact = {
      name: "Masoud Zangeneh",
      title: "Financial Advisor",
      phone: "647-000-0000",
      email: "masoud@example.com",
      place: "Masoud Zangeneh",
      website: "https://uniqueadvisor.example",
    };
    const letterHtml = renderEletter({
      letter: { kind: "eletter", design: "plum", kicker: "A letter", title: "Hello", subject: "Hello", body: "Dear Max Santiago,\n\nA note.", social: emptySocial() },
      contact,
      logoSrc: "",
    });
    const newsHtml = renderNewsletter({
      issue: { design: "navy", kicker: "Newsletter", title: "Update", subject: "Update", articles: [{ title: "Markets", body: "A short note." }], social: emptySocial() },
      contact,
      logoSrc: "",
    });
    for (const html of [letterHtml, newsHtml]) {
      const footer = html.split(/bgcolor="#5c1a4a"|bgcolor="#0c2f6b"/i).pop() || "";
      const text = footer.replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ");
      const lines = text.split("\n").map((line) => line.replace(/^[^A-Za-z0-9]+/, "").trim()).filter(Boolean);
      const keys = lines.map((line) => line.toLowerCase());
      assert.equal(new Set(keys).size, keys.length);
      assert.equal(lines.filter((line) => line === "Masoud Zangeneh").length, 1);
      assert.equal(lines.includes("Zangeneh Law Firm"), false);
    }
  });

  it("prints the compliance line once and names a Zoom meeting", () => {
    const letter = buildMeetingLetter({
      kind: "cancel",
      audience: "client",
      clientName: "Max Santiago",
      advisorName: "Masoud Zangeneh",
      advisorTitle: "Financial Advisor",
      advisorPhone: "4168320416",
      advisorEmail: "masoud@example.com",
      advisorCompany: "Unique Advisor",
      advisorWebsite: "uniqueadvisor.example",
      topic: "Meeting with Max Santiago",
      whenUtc: "2026-07-07T19:00:00.000Z",
      timeZone: "America/Toronto",
      minutes: 60,
      join,
      design: "plum",
    });
    const line = "This message was sent by Masoud Zangeneh, Unique Advisor to tell you a scheduled meeting was cancelled.";
    assert.equal(letter.text.split(line).length - 1, 1);
    assert.equal(visible(letter.html).split(line).length - 1, 1);
    assert.match(letter.text, /Subject: Zoom meeting with Masoud Zangeneh/);
    assert.doesNotMatch(letter.text, /Subject: Meeting with/);
    assert.doesNotMatch(letter.text, /Subject: Zoom meeting with Max Santiago/);
    assert.match(letter.subject, /^Meeting cancelled: Zoom meeting with Masoud Zangeneh$/);
    assert.match(letter.html, /Eastern Time \(Toronto\)/);
    assert.doesNotMatch(letter.text, /\bEDT\b/);
    assert.match(letter.text, /\(416\) 832-0416/);
    assert.match(letter.html, />Visit my website</);
  });

  it("names the advisor on client emails and the contact on the advisor copy", () => {
    const when = "Sat, Nov 7, 3:00 PM";
    for (const kind of ["confirm", "reminder", "cancel"] as const) {
      const client = letterFor("Max Santiago", "client", kind);
      const advisor = letterFor("Max Santiago", "advisor", kind);
      assert.match(client.text, /Subject: Zoom meeting with Masoud Zangeneh/);
      assert.doesNotMatch(client.text, /Subject: Zoom meeting with Max Santiago/);
      assert.match(advisor.text, /Subject: Annual review/);
      if (kind === "confirm") {
        assert.equal(client.subject, `Zoom meeting with Masoud Zangeneh – ${when}`);
        assert.equal(advisor.subject, `Zoom meeting with Max Santiago – ${when}`);
      } else if (kind === "reminder") {
        assert.equal(client.subject, "Reminder: Zoom meeting with Masoud Zangeneh");
        assert.equal(advisor.subject, "Reminder: Annual review");
      } else {
        assert.equal(client.subject, "Meeting cancelled: Zoom meeting with Masoud Zangeneh");
        assert.equal(advisor.subject, "Meeting cancelled: Annual review");
      }
    }
    const named = {
      clientName: "Max Santiago",
      advisorName: "Masoud Zangeneh",
      advisorTitle: "Financial Advisor",
      advisorPhone: "647-000-0000",
      advisorEmail: "masoud@example.com",
      advisorCompany: "Unique Advisor",
      advisorWebsite: "https://uniqueadvisor.example",
      topic: "Meeting with Max Santiago",
      whenUtc: "2026-11-09T19:00:00.000Z",
      timeZone: "America/Toronto",
      minutes: 60,
      join,
      meetingId: "123",
      passcode: "",
      icsToken: "abc123abc123abc123abc123abc123ab",
      design: "plum" as const,
    };
    const clientDefault = buildMeetingLetter({ ...named, kind: "confirm", audience: "client" });
    const advisorDefault = buildMeetingLetter({ ...named, kind: "confirm", audience: "advisor" });
    assert.equal(clientDefault.subject, "Zoom meeting with Masoud Zangeneh – Mon, Nov 9, 2:00 PM");
    assert.match(clientDefault.text, /Subject: Zoom meeting with Masoud Zangeneh/);
    assert.equal(advisorDefault.subject, "Zoom meeting with Max Santiago – Mon, Nov 9, 2:00 PM");
    assert.match(advisorDefault.text, /Subject: Zoom meeting with Max Santiago/);
  });
});

describe("saved advisor website", () => {
  const oldSite = "https://youradviser.grok.me/a/masoud-zangeneh/site";
  const ownSite = "https://masoud.example";

  it("uses the website saved in Settings and falls back only when that field is empty", () => {
    assert.equal(shownWebsite({ siteMode: "own", siteUrl: ownSite, publicWebsite: oldSite, slug: "masoud-zangeneh" }), ownSite);
    assert.equal(shownWebsite({ siteMode: "builtin", siteUrl: "", publicWebsite: "", slug: "masoud-zangeneh" }), oldSite);
    const letter = buildMeetingLetter({
      kind: "confirm",
      audience: "client",
      clientName: "Max Santiago",
      advisorName: "Masoud Zangeneh",
      advisorTitle: "Financial Advisor",
      advisorPhone: "4168320416",
      advisorEmail: "masoud@example.com",
      advisorCompany: "Unique Advisor",
      advisorWebsite: shownWebsite({ siteMode: "own", siteUrl: ownSite, publicWebsite: oldSite, slug: "masoud-zangeneh" }),
      topic: "Annual review",
      whenUtc: "2026-11-09T19:00:00.000Z",
      timeZone: "America/Toronto",
      minutes: 60,
      join,
      meetingId: "123",
      passcode: "",
      icsToken: "abc123abc123abc123abc123abc123ab",
      design: "plum",
    });
    assert.match(letter.html, /#C9A227/);
    assert.match(letter.html, new RegExp(`href="${ownSite}"`));
    assert.match(letter.html, />Visit my website</);
    assert.doesNotMatch(letter.html.replace(/<[^>]+>/g, " "), /masoud\.example/);
    assert.doesNotMatch(letter.html, /youradviser\.grok\.me\/a\/masoud-zangeneh\/site">Visit my website/);
    assert.equal(useCurrentWebsite(`Visit my website ${oldSite}`, ownSite).includes(ownSite), true);
    assert.equal(useCurrentWebsite(`Visit my website ${oldSite}`, ownSite).includes(oldSite), false);
    const booking = "https://youradviser.grok.me/api/book/abc123abc123abc123abc123abc123ab";
    assert.equal(useCurrentWebsite(`<a href="${booking}">Book a meeting</a>`, ownSite, [oldSite]), `<a href="${booking}">Book a meeting</a>`);
  });

  it("switches e-cards and newsletters to the system website and hides the raw address", () => {
    const system = shownWebsite({ siteMode: "builtin", siteUrl: ownSite, publicWebsite: ownSite, slug: "masoud-zangeneh" });
    assert.equal(system, oldSite);
    const contact = {
      name: "Masoud Zangeneh",
      title: "Financial Advisor",
      phone: "(416) 832-0416",
      email: "masoud@example.com",
      place: "Unique Advisor",
      website: system,
    };
    const news = renderNewsletter({
      issue: { design: "navy", kicker: "Newsletter", title: "Family protection", subject: "Family protection", articles: [{ title: "Why cover matters", body: "A short note for the family." }], social: emptySocial() },
      contact,
      logoSrc: "",
    });
    const letter = renderEletter({
      letter: { kind: "eletter", design: "azure", kicker: "A letter", title: "A note", subject: "A note", body: "Dear Max Santiago,\n\nHere is a short letter.", social: emptySocial() },
      contact,
      logoSrc: "",
    });
    const card = cardHtml("Dear Max Santiago,\n\nThinking of you.", "", signatureWithWebsite("Masoud Zangeneh\nFinancial Advisor\nhttps://masoud.example", system));
    for (const html of [news, letter, card]) {
      assert.match(html, new RegExp(`href="${oldSite}"`));
      assert.match(html, /#C9A227/);
      assert.match(html, />Visit my website</);
      const shown = html.replace(/<[^>]+>/g, " ");
      assert.doesNotMatch(shown, /https?:\/\//);
      assert.doesNotMatch(shown, /masoud\.example/);
    }
    assert.equal(websiteButtonText(system), `Visit my website: ${oldSite}`);
  });
});
