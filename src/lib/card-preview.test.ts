import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CARD_APPROVAL, planCardPreview, simulateCardDelivery } from "./card-preview.ts";

const sender = "info@zangenehlaw.ca";

describe("fictional e-card preview", () => {
  it("selects a recorded group, excludes unsubscribed and missing email, and does not send", () => {
    const planned = planCardPreview({ request: "Send a holiday greeting to life insurance clients from the fictional database", sender });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.equal(planned.design.title, "Holiday Greeting");
    assert.equal(planned.sender, sender);
    assert.deepEqual(planned.recipients.map((contact) => contact.name), ["Casey Sample", "Riley Sample"]);
    assert.equal(planned.count, 2);
    assert.match(planned.exclusions.join("\n"), /Quinn Sample.*Unsubscribed/);
    assert.match(planned.exclusions.join("\n"), /Avery Sample.*No email/);
    assert.match(planned.preview, /Morgan Sample: TFSA Client/);
    assert.match(planned.preview, /Nothing has been sent/);
    assert.equal(planned.preview.includes("this email has not been sent"), false);
  });

  it("uses the specified Dropbox contact source for a named contact", () => {
    const planned = planCardPreview({ request: "Send the thank you card to Jordan Example from the Dropbox fictional contact file", sender });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.equal(planned.source, "dropbox");
    assert.deepEqual(planned.recipients.map((contact) => contact.email), ["jordan.example@example.invalid"]);
    assert.equal(planned.design.title, "Thank You");
  });

  it("does not invent a database contact that exists only in the Dropbox source", () => {
    const planned = planCardPreview({ request: "Send the thank you card to Jordan Example from the fictional database", sender });
    assert.equal(planned.ok, false);
  });

  it("simulates one approved delivery and blocks the duplicate", () => {
    const sent = new Set<string>();
    const request = "Send a holiday greeting to life insurance clients from the fictional database";
    const first = simulateCardDelivery({ request, sender, approval: CARD_APPROVAL, sent });
    const second = simulateCardDelivery({ request, sender, approval: CARD_APPROVAL, sent });
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.emailed, false);
    assert.equal(second.ok, false);
    const blocked = planCardPreview({ request, sender, alreadySent: [...sent] });
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    assert.equal(blocked.count, 0);
    assert.match(blocked.exclusions.join("\n"), /already sent/i);
  });

  it("does not simulate an unsubscribed named contact", () => {
    const result = simulateCardDelivery({
      request: "Send a birthday card to Quinn Sample from the fictional database",
      sender,
      approval: CARD_APPROVAL,
      sent: new Set(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.emailed, false);
  });
});
