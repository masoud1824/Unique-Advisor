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
  readApprovedUsefulLink,
  readPublicHttps,
  sameLibrarySite,
  savedLinkBlockedNote,
  declinedSavedLink,
  foundFormNote,
  officialFormWebSearch,
  searchPublicFormPages,
  verifySavedDocument,
  webSearchBlockedNote,
} from "./form-lookup.ts";
import { chooseForm, formsFromPage } from "./desk-workflows.ts";
import { isFormAsk } from "./advisor-intent.ts";
import { asksContactRecord, asksExplicitWebFormSearch } from "./delivery-audience.ts";
import { orchestrationControl } from "./orchestration.ts";
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

  it("reads an approved Useful Link while outbound stays blocked, and rejects private redirects", async () => {
    const previousBlock = process.env.UA_OUTBOUND_BLOCK;
    const previousRelease = process.env.UA_RELEASE_ENV;
    process.env.UA_OUTBOUND_BLOCK = "1";
    process.env.UA_RELEASE_ENV = "staging";
    const html = `<tr><td scope="row">0671BCF</td><td></td><td><a href="/advisor/getattachment/671BCF.pdf" class="f6 font-weight-bold">Beneficiary Change Request Form <span class="sr-only">File</span></a><br /><span>A digital version of this form is available on the Beneficiary tab</span></td><td><a href="/advisor/getattachment/671BCF-FR.pdf" class="f6 advisor-form-lang">FR</a></td></tr><tr><td scope="row">0594</td><td><a href="/advisor/getattachment/594.pdf" class="f6 font-weight-bold">Business Information Form <span class="sr-only">File</span></a></td></tr>`;
    const publicLookup = async () => ["203.0.113.10"];
    let calls: string[] = [];
    const opened = await readApprovedUsefulLink("https://advisor.example.com/forms", (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch, publicLookup);
    assert.equal(opened.ok, true);
    if (opened.ok) {
      const forms = formsFromPage(opened.text, opened.finalUrl);
      const choice = chooseForm(forms, "find a change of beneficiary form from equitable and show me here");
      assert.equal(choice.kind, "one");
      if (choice.kind === "one") {
        assert.equal(choice.form.title, "Beneficiary Change Request Form (0671BCF)");
        assert.equal(choice.form.href, "https://advisor.example.com/advisor/getattachment/671BCF.pdf");
      }
    }
    const checked = await verifySavedDocument("https://advisor.example.com/advisor/getattachment/671BCF.pdf", (async () => new Response(null, { status: 200, headers: { "content-type": "application/pdf" } })) as typeof fetch, publicLookup);
    assert.equal(checked.ok, true);
    calls = [];
    const redirected = await readApprovedUsefulLink("https://advisor.example.com/forms", (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(null, { status: 302, headers: { location: "https://10.1.1.1/secret" } });
    }) as typeof fetch, publicLookup);
    assert.equal(redirected.ok, false);
    if (!redirected.ok) assert.match("access" in redirected ? redirected.access : "", /private network/);
    assert.deepEqual(calls, ["https://advisor.example.com/forms"]);
    const searched = await searchPublicFormPages("change of beneficiary", (() => Promise.resolve(new Response("no"))) as typeof fetch);
    assert.match(searched, /was not searched/);
    assert.equal(sameLibrarySite("https://advisor.example.com/forms", "https://cdn.example.com/file.pdf"), false);
    assert.equal(publicHttpsTarget("https://user:secret@advisor.example.com/forms").ok, false);
    if (previousBlock === undefined) delete process.env.UA_OUTBOUND_BLOCK;
    else process.env.UA_OUTBOUND_BLOCK = previousBlock;
    if (previousRelease === undefined) delete process.env.UA_RELEASE_ENV;
    else process.env.UA_RELEASE_ENV = previousRelease;
  });
});

describe("explicit provider form web search", () => {
  const manulife = "Search the web for Manulife Canada’s official individual life insurance beneficiary-change form. Do not use the saved Equitable link. Return the official form link and the source page where you found it. If web search is unavailable, say so.";
  const samples = [
    manulife,
    "Look online for Sun Life's change of beneficiary form. Do not use a saved link.",
    "Find the official Canada Life beneficiary form on the web and give me the source page.",
    "Search the internet for the iA Financial individual life beneficiary-change form.",
  ];

  it("does not treat a provider form search as a contact lookup", () => {
    for (const line of samples) {
      assert.equal(asksExplicitWebFormSearch(line), true, line);
      assert.equal(asksContactRecord(line), false, line);
      assert.equal(isFormAsk(line), true, line);
      assert.equal(contentHoldKind(line), "form", line);
      assert.equal(orchestrationControl(line).conversational, false, line);
      assert.equal(orchestrationControl(line).desk, true, line);
    }
    assert.equal(asksExplicitWebFormSearch("Do not search the web for the Manulife form."), false);
    assert.equal(asksContactRecord("Show the saved contact record for Casey Sample, including email and phone."), true);
    assert.equal(declinedSavedLink(manulife, "Equitable forms"), true);
    assert.equal(declinedSavedLink(manulife, "Manulife forms"), false);
    assert.doesNotMatch(foundFormNote("Equitable forms", "https://example.test/eq", "Beneficiary"), /verified/);
    assert.match(foundFormNote("Equitable forms", "https://example.test/eq", "Beneficiary", true), /stored Useful Link/);
    assert.match(foundFormNote("Equitable forms", "https://example.test/eq", "Beneficiary", true), /not a new web search/);
  });

  it("reports a blocked web search instead of a saved link or a contact", async () => {
    const previous = process.env.UA_RELEASE_ENV;
    process.env.UA_RELEASE_ENV = "staging";
    let called = false;
    const reply = await officialFormWebSearch(manulife, (() => {
      called = true;
      return Promise.resolve(new Response("no"));
    }) as typeof fetch);
    assert.equal(called, false);
    assert.match(reply, /Web search is unavailable/);
    assert.match(reply, /was not searched/);
    assert.doesNotMatch(reply, /contacts table/);
    assert.doesNotMatch(reply, /Equitable/);
    const follow = await officialFormWebSearch("yes, search the web", (() => Promise.resolve(new Response("no"))) as typeof fetch);
    assert.equal(follow, "");
    if (previous === undefined) delete process.env.UA_RELEASE_ENV;
    else process.env.UA_RELEASE_ENV = previous;
  });
});
