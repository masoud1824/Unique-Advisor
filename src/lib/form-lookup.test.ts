import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORM_WEB_ASK,
  blockedReadNote,
  explainFormLookup,
  formWebPrompt,
  isFormWebAgreement,
  linksForFormRequest,
  pendingFormRequest,
  publicHttpsTarget,
  publicResultLinks,
  readPublicHttps,
  savedLinkBlockedNote,
  searchPublicFormPages,
  webSearchBlockedNote,
} from "./form-lookup.ts";
import { isFormAsk } from "./advisor-intent.ts";
import { contentHoldKind } from "./workspace-policy.ts";

describe("useful links before the web", () => {
  it("asks to search the web only after a real miss and keeps the form on that question", () => {
    const prompt = formWebPrompt("find the change of beneficiary form");
    assert.match(prompt, new RegExp(FORM_WEB_ASK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(pendingFormRequest(prompt), "find the change of beneficiary form");
    assert.equal(isFormWebAgreement("yes", prompt), true);
    assert.equal(isFormWebAgreement("search online", prompt), true);
    assert.equal(isFormWebAgreement("yes send the email", prompt), false);
    assert.equal(isFormWebAgreement("yes", "Just to confirm: send the card?"), false);
  });

  it("matches a saved link without calling a miss an access failure", () => {
    const links = [
      { label: "Equitable forms", url: "https://example.test/equitable" },
      { label: "Notes", url: "https://example.test/notes" },
    ];
    assert.equal(linksForFormRequest(links, "find the equitable beneficiary form").length, 1);
    assert.match(blockedReadNote(), /not treated as not found/);
    assert.match(webSearchBlockedNote(), /was not searched/);
    const blocked = explainFormLookup({
      links,
      request: "get an Equitable Life beneficiary form and save it in Dropbox",
      page: { ok: false, blocked: true },
    });
    assert.match(blocked, /Equitable forms/);
    assert.match(blocked, /https:\/\/example\.test\/equitable/);
    assert.match(blocked, /access limit/);
    assert.doesNotMatch(blocked, /could not find this form/);
    const miss = explainFormLookup({ links: [{ label: "Notes", url: "https://example.test/notes" }], request: "find the equitable beneficiary form" });
    assert.match(miss, /Would you like me to search online/);
    assert.match(savedLinkBlockedNote("Equitable forms", "https://example.test/equitable"), /not a missing form/);
    const ask = "get an Equitable Life beneficiary form, fill with fictional Avery Example info and save in Dropbox";
    assert.equal(isFormAsk(ask), true);
    assert.equal(contentHoldKind(ask), "form");
  });

  it("rejects private and non-https addresses and does not fetch while outbound is blocked", async () => {
    assert.equal(publicHttpsTarget("http://example.com/form").ok, false);
    assert.equal(publicHttpsTarget("https://127.0.0.1/form").ok, false);
    assert.equal(publicHttpsTarget("https://169.254.169.254/latest").ok, false);
    assert.equal(publicHttpsTarget("https://10.1.1.1/form").ok, false);
    assert.equal(publicHttpsTarget("https://forms.example.com/life.pdf").ok, true);
    assert.equal(publicHttpsTarget("https://2130706433/form").ok, false);
    assert.equal(publicHttpsTarget("https://127.0.1/form").ok, false);
    const previous = process.env.UA_OUTBOUND_BLOCK;
    process.env.UA_OUTBOUND_BLOCK = "1";
    let called = false;
    const blocked = await readPublicHttps("https://forms.example.com/life.pdf", (() => {
      called = true;
      return Promise.resolve(new Response("no"));
    }) as typeof fetch);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.blocked, true);
    assert.equal(called, false);
    const searched = await searchPublicFormPages("change of beneficiary form", (() => {
      called = true;
      return Promise.resolve(new Response("no"));
    }) as typeof fetch);
    assert.match(searched, /was not searched/);
    assert.equal(called, false);
    if (previous === undefined) delete process.env.UA_OUTBOUND_BLOCK;
    else process.env.UA_OUTBOUND_BLOCK = previous;
    const links = publicResultLinks('<a href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fforms.example.com%2Flife.pdf">Life form</a><a href="https://127.0.0.1/secret">Secret</a>');
    assert.deepEqual(links, [{ title: "Life form", href: "https://forms.example.com/life.pdf" }]);
  });
});
