import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyModelAccess } from "../agent/model-config.ts";
import {
  TEST_PLAN,
  accountView,
  agreePurchase,
  alterPurchaseTerms,
  applyPaymentEvent,
  browserReturnCreditsBalance,
  cancelReservation,
  openAccount,
  packQuote,
  paymentConfigured,
  planPrices,
  reconcile,
  refundOperation,
  reserve,
  rollPeriod,
  schedulePlanChange,
  signatureMatches,
  testSignature,
  type Ledger,
  type PlanDocument,
  type Purchase,
} from "./usage.ts";

const FIXTURE_PLAN: PlanDocument = {
  ...TEST_PLAN,
  id: "fixture-only",
  label: "isolated fixture",
  pricesApproved: true,
  currency: "CAD",
  subscriptionCadCents: 111,
  packCadCents: 222,
  packTokens: 333,
  packValidityDays: 30,
  taxRate: 0,
};

function ledger(now = new Date("2026-11-26T00:00:00.000Z")): Ledger {
  return { account: openAccount("advisor-7", now), operations: new Map(), providerIds: new Map() };
}

describe("usage allowance", () => {
  it("keeps published pricing unset and checkout off", () => {
    const prices = planPrices();
    assert.equal(prices.pricing, "unset");
    assert.equal(prices.checkout, "disabled");
    assert.equal(prices.subscription, null);
    assert.equal(prices.topUp, null);
    assert.equal(JSON.stringify(prices).includes("49"), false);
    assert.equal(JSON.stringify(prices).includes("249"), false);
    const view = accountView(openAccount("advisor-7", new Date("2026-11-26T00:00:00.000Z")));
    assert.equal(view.subscription, null);
    assert.equal(view.topUp, null);
    assert.equal(view.checkout, "disabled");
    const quote = packQuote();
    assert.equal(quote.priceCadCents, null);
    assert.equal(quote.checkout, "disabled");
    process.env.BILLING_PAYMENT_PROVIDER = "test";
    const blocked = agreePurchase("advisor-7");
    assert.equal("error" in blocked, true);
    if ("error" in blocked) assert.match(blocked.error, /Pricing is not set/);
    delete process.env.BILLING_PAYMENT_PROVIDER;
  });

  it("stops a second reservation that would pass the allowance", () => {
    const book = ledger();
    const first = reserve(book, { operationId: "a", kind: "model", estimateTokens: 1_500_000 });
    const second = reserve(book, { operationId: "b", kind: "model", estimateTokens: 1_500_000 });
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "allowance-exhausted");
    assert.equal(reserve(book, { operationId: "a", kind: "model", estimateTokens: 1_500_000 }).ok, true);
  });

  it("reconciles once, refunds, and does not roll purchased balance into a new period", () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    const book = ledger(now);
    reserve(book, { operationId: "job", kind: "model", estimateTokens: 100_000 });
    const done = reconcile(book, { operationId: "job", actualTokens: 80_000, providerRequestId: "req-1", usageSource: "provider" });
    assert.equal(done.ok, true);
    assert.equal(book.account.includedUsedTokens, 80_000);
    assert.equal(book.account.reservedTokens, 0);
    const again = reconcile(book, { operationId: "other", actualTokens: 80_000, providerRequestId: "req-1", usageSource: "provider" });
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.duplicate, true);
    assert.equal(book.account.includedUsedTokens, 80_000);
    assert.equal(refundOperation(book, "job").ok, true);
    assert.equal(book.account.includedUsedTokens, 0);
    book.account.purchasedTokens = 50_000;
    book.account.purchasedExpires = "2027-11-26T00:00:00.000Z";
    rollPeriod(book.account, new Date(book.account.periodEnd));
    assert.equal(book.account.includedUsedTokens, 0);
    assert.equal(book.account.purchasedTokens, 50_000);
  });

  it("cancels a reservation without charging and isolates advisors", () => {
    const book = ledger();
    reserve(book, { operationId: "voice", kind: "speech", estimateTokens: 20_000 });
    assert.equal(cancelReservation(book, "voice").ok, true);
    assert.equal(book.account.reservedTokens, 0);
    assert.equal(book.account.includedUsedTokens, 0);
    const other = ledger();
    other.account.advisorId = "advisor-8";
    reserve(other, { operationId: "voice", kind: "speech", estimateTokens: 20_000 });
    assert.equal(book.account.reservedTokens, 0);
    assert.equal(other.account.reservedTokens, 20_000);
  });

  it("credits a pack only from a signed paid event", () => {
    const previous = process.env.BILLING_PAYMENT_PROVIDER;
    process.env.BILLING_PAYMENT_PROVIDER = "test";
    const now = new Date("2026-11-26T00:00:00.000Z");
    const book = ledger(now);
    const agreed = agreePurchase("advisor-7", FIXTURE_PLAN, now);
    assert.equal("id" in agreed, true);
    if (!("id" in agreed)) return;
    const purchases = new Map<string, Purchase>([[agreed.id, agreed]]);
    const events = new Map<string, string>();
    const raw = JSON.stringify({ id: "evt-1", type: "paid", purchaseId: agreed.id, advisorId: "advisor-7" });
    assert.equal(signatureMatches(raw, testSignature(raw)), true);
    assert.equal(signatureMatches(raw, "nope"), false);
    assert.equal(browserReturnCreditsBalance(), false);
    const wrong = applyPaymentEvent({ purchases, events: new Map(), account: book.account, event: { id: "evt-x", type: "paid", purchaseId: agreed.id, advisorId: "advisor-8" }, now });
    assert.equal(wrong.ok, false);
    const paid = applyPaymentEvent({ purchases, events, account: book.account, event: { id: "evt-1", type: "paid", purchaseId: agreed.id, advisorId: "advisor-7" }, now });
    assert.equal(paid.credited, true);
    assert.equal(book.account.purchasedTokens, agreed.tokens);
    const duplicate = applyPaymentEvent({ purchases, events, account: book.account, event: { id: "evt-1", type: "paid", purchaseId: agreed.id, advisorId: "advisor-7" }, now });
    assert.equal(duplicate.duplicate, true);
    assert.equal(book.account.purchasedTokens, agreed.tokens);
    const early = applyPaymentEvent({ purchases, events, account: book.account, event: { id: "evt-2", type: "refunded", purchaseId: agreed.id, advisorId: "advisor-7" }, now });
    assert.equal(early.ok, true);
    assert.equal(agreed.status, "refunded");
    assert.equal(alterPurchaseTerms().ok, false);
    const next = schedulePlanChange(FIXTURE_PLAN, { subscriptionCadCents: 111 }, "2026-12-26T00:00:00.000Z");
    assert.equal(next.version, 2);
    assert.equal(agreed.priceCadCents, 222);
    assert.equal(agreed.tokens, 333);
    process.env.BILLING_PAYMENT_PROVIDER = previous;
    assert.equal(paymentConfigured(), previous === "test");
  });

  it("does not create a purchase when the payment provider is off", () => {
    const previous = process.env.BILLING_PAYMENT_PROVIDER;
    delete process.env.BILLING_PAYMENT_PROVIDER;
    const result = agreePurchase("advisor-7");
    assert.equal("error" in result, true);
    process.env.BILLING_PAYMENT_PROVIDER = previous;
  });
});

describe("model access", () => {
  it("reports a missing model and does not substitute another", async () => {
    const result = await verifyModelAccess("sk-test", (async () => new Response("missing", { status: 404 })) as typeof fetch);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.blocker, /No fallback model was used/);
      const chosen = String(process.env.UA_AGENT_MODEL || "").trim();
      const expected = chosen === "grok-4.7" || chosen.startsWith("grok-4.7-") ? chosen : "grok-4.7";
      assert.equal(result.model, expected);
    }
  });
});
