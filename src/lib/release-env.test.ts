import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asksArchiveSearch, asksCampaignControl, asksContactRecord, asksSavedCampaignReview, archiveSearchTerm, matchingNewsletterCopies } from "./delivery-audience.ts";
import { isInboxAsk, taskKind } from "./advisor-intent.ts";
import { contentHoldKind, deliveryRequested } from "./workspace-policy.ts";
import { ACCEPTANCE_PORT, assertReleaseDatabase, assertReleaseProcess, FORBIDDEN_DATA_DIRS } from "./release-env.ts";
import { externalSideEffectsBlocked } from "./isolated-test-desk.ts";
import fixture from "../../fixtures/sanitized-practice.fixture.json" with { type: "json" };

describe("release environment refuses the acceptance desk", () => {
  it("rejects every protected database path", () => {
    const previousEnv = process.env.UA_RELEASE_ENV;
    const previousRoot = process.env.UA_RELEASE_DATA_ROOT;
    const previousUrl = process.env.DATABASE_URL;
    process.env.UA_RELEASE_ENV = "development";
    process.env.UA_RELEASE_DATA_ROOT = "/opt/ua-release/data";
    delete process.env.DATABASE_URL;
    try {
      for (const dir of FORBIDDEN_DATA_DIRS) {
        assert.throws(() => assertReleaseDatabase(dir), /refuses/);
      }
      assert.throws(() => assertReleaseDatabase("/tmp/not-the-release-root"), /outside/);
      assert.doesNotThrow(() => assertReleaseDatabase("/opt/ua-release/data/dev"));
      process.env.DATABASE_URL = "postgres://example";
      assert.throws(() => assertReleaseDatabase("/opt/ua-release/data/dev"), /hosted DATABASE_URL/);
    } finally {
      process.env.UA_RELEASE_ENV = previousEnv;
      process.env.UA_RELEASE_DATA_ROOT = previousRoot;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });

  it("reserves the acceptance port and source tree", () => {
    assert.throws(() => assertReleaseProcess({ cwd: "/opt/ua-release/repos/dev", port: ACCEPTANCE_PORT }), /8080/);
    assert.throws(() => assertReleaseProcess({ cwd: "/workspace", port: 8092 }), /acceptance source/);
    assert.doesNotThrow(() => assertReleaseProcess({ cwd: "/opt/ua-release/repos/dev", port: 8092 }));
  });

  it("blocks outbound work when the release environment is set", () => {
    const previous = process.env.UA_RELEASE_ENV;
    process.env.UA_RELEASE_ENV = "staging";
    try {
      assert.equal(externalSideEffectsBlocked(), true);
    } finally {
      if (previous === undefined) delete process.env.UA_RELEASE_ENV;
      else process.env.UA_RELEASE_ENV = previous;
    }
  });
});

describe("prior desk defects stay grounded", () => {
  const keepInactive = "Before considering enrollment, let me inspect the actual saved messages and delays in Acceptance — Welcome Drip for Riley Sample and Avery Sample. Identify anyone who cannot receive it. Leave it inactive and make no changes.";
  const piece = "Which saved issues include a piece on the time value of money? Give their IDs without changing them.";
  const casey = "Without changing anything, show Casey Sample alone from Unique Advisor contacts, including email and tags. Do not look in Dropbox.";

  it("keeps a drip review when inactive is only a constraint", () => {
    assert.equal(asksSavedCampaignReview(keepInactive), true);
    assert.equal(asksCampaignControl(keepInactive), false);
    assert.equal(deliveryRequested(keepInactive), false);
    assert.equal(contentHoldKind(keepInactive), "campaign");
  });

  it("searches article text rather than the newsletter title", () => {
    assert.equal(asksArchiveSearch(piece), true);
    const hits = matchingNewsletterCopies(
      [fixture.newsletterCopy1, fixture.newsletterCopy2],
      archiveSearchTerm(piece),
    );
    assert.deepEqual(hits.map((hit) => hit.id), [1, 2]);
  });

  it("does not turn a contact email field into an inbox check", () => {
    assert.equal(asksContactRecord(casey), true);
    assert.equal(isInboxAsk(casey), false);
    assert.equal(taskKind(casey), "contact-record");
  });

  it("records the sanitized fixture, which is not a live backup", () => {
    assert.equal(fixture.kind, "sanitized-test-fixture");
    assert.equal(fixture.notADatabaseBackup, true);
    assert.equal(fixture.newsletterCopy1.articles.length, 5);
    assert.equal(fixture.newsletterCopy1.articles[4].title, "Practice Follow-Up");
    assert.equal(fixture.newsletterCopy2.articles.length, 4);
    assert.match(fixture.letter.body, /combined edit works/);
    assert.match(fixture.card.body, /Thank you for your trust/);
    assert.equal(fixture.drip.active, false);
    assert.equal(fixture.drip.step2WaitDays, 3);
    assert.deepEqual(fixture.eligibility.included, ["Casey Sample", "Jordan Example", "Riley Sample"]);
    assert.equal(fixture.eligibility.unsubscribed, "Quinn Sample");
    assert.equal(fixture.eligibility.missingEmail, "Avery Sample");
    assert.equal(fixture.eligibility.tfsaOnly, "Morgan Sample");
  });
});
