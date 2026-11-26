import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** Published commercial settings. Prices, currency, and allowances stay unset until Masoud approves them. */
export const TEST_TAX_NOTE = "Tax is not configured.";

export type PlanDocument = {
  version: number;
  id: string;
  label: string;
  pricesApproved: boolean;
  currency: "CAD" | null;
  baseWithoutAiCadCents: number | null;
  subscriptionCadCents: number | null;
  includedTokens: number;
  packId: string;
  packCadCents: number | null;
  packTokens: number;
  packValidityDays: number;
  taxRate: number | null;
  warnAt: number[];
  formFill: false;
  premiumModel: false;
  effectiveAt: string;
};

/** The plan the app serves. It contains no price, currency, or top-up offer. */
export const TEST_PLAN: PlanDocument = {
  version: 1,
  id: "unset",
  label: "Pricing is not set",
  pricesApproved: false,
  currency: null,
  baseWithoutAiCadCents: null,
  subscriptionCadCents: null,
  includedTokens: 2_000_000,
  packId: "unset",
  packCadCents: null,
  packTokens: 0,
  packValidityDays: 0,
  taxRate: null,
  warnAt: [0.8, 1],
  formFill: false,
  premiumModel: false,
  effectiveAt: "2026-11-26T00:00:00.000Z",
};

export function planPrices(plan = TEST_PLAN) {
  if (!plan.pricesApproved) {
    return {
      pricing: "unset" as const,
      checkout: "disabled" as const,
      currency: null,
      subscription: null,
      topUp: null,
      providerDollarCost: null,
      note: "Pricing, currency, and the included allowance are not set. Checkout is off. Nothing can be charged.",
    };
  }
  return {
    pricing: "configured" as const,
    checkout: "disabled" as const,
    currency: plan.currency,
    subscriptionCadCents: plan.subscriptionCadCents,
    topUpCadCents: plan.packCadCents,
    providerDollarCost: null,
    note: "A plan document exists for admin configuration. Checkout stays off until payment setup is approved.",
  };
}

export function packQuote(plan = TEST_PLAN) {
  if (!plan.pricesApproved || plan.packCadCents == null || plan.taxRate == null || plan.currency == null) {
    return {
      checkout: "disabled" as const,
      quantity: 0,
      packId: plan.packId,
      currency: null,
      priceCadCents: null,
      taxCadCents: null,
      totalCadCents: null,
      tokens: null,
      validityDays: null,
      note: "Pricing is not set. Checkout is off. No pack is offered.",
    };
  }
  const taxCadCents = Math.round(plan.packCadCents * plan.taxRate);
  return {
    checkout: "disabled" as const,
    quantity: 1,
    packId: plan.packId,
    currency: plan.currency,
    priceCadCents: plan.packCadCents,
    taxCadCents,
    totalCadCents: plan.packCadCents + taxCadCents,
    tokens: plan.packTokens,
    validityDays: plan.packValidityDays,
    taxNote: TEST_TAX_NOTE,
    providerDollarCost: null,
    note: "Checkout stays off until payment setup is approved.",
  };
}

export type Account = {
  advisorId: string;
  planVersion: number;
  status: "active" | "canceled";
  periodStart: string;
  periodEnd: string;
  includedTokens: number;
  includedUsedTokens: number;
  purchasedTokens: number;
  purchasedUsedTokens: number;
  purchasedExpires: string;
  reservedTokens: number;
};

export type Operation = {
  operationId: string;
  kind: string;
  status: "reserved" | "reconciled" | "canceled" | "refunded";
  estimateTokens: number;
  actualTokens: number;
  providerRequestId: string;
  usageSource: "provider" | "estimate";
};

export function openAccount(advisorId: string, now: Date, plan = TEST_PLAN): Account {
  const start = now.toISOString();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    advisorId,
    planVersion: plan.version,
    status: "active",
    periodStart: start,
    periodEnd: end,
    includedTokens: plan.includedTokens,
    includedUsedTokens: 0,
    purchasedTokens: 0,
    purchasedUsedTokens: 0,
    purchasedExpires: start,
    reservedTokens: 0,
    };
}

export function remainingTokens(account: Account, now = new Date()) {
  const included = account.status === "canceled" && now.toISOString() >= account.periodEnd
    ? 0
    : Math.max(0, account.includedTokens - account.includedUsedTokens);
  const purchased = now.toISOString() < account.purchasedExpires
    ? Math.max(0, account.purchasedTokens - account.purchasedUsedTokens)
    : 0;
  return Math.max(0, included + purchased - account.reservedTokens);
}

export function usageRatio(account: Account) {
  const included = Math.max(1, account.includedTokens);
  return account.includedUsedTokens / included;
}

export function usageWarnings(account: Account, plan = TEST_PLAN) {
  const ratio = usageRatio(account);
  return plan.warnAt.filter((mark) => ratio >= mark);
}

export type Ledger = {
  account: Account;
  operations: Map<string, Operation>;
  providerIds: Map<string, string>;
};

export function reserve(ledger: Ledger, input: { operationId: string; kind: string; estimateTokens: number }, now = new Date()) {
  const existing = ledger.operations.get(input.operationId);
  if (existing) return { ok: true as const, duplicate: true, operation: existing, account: ledger.account };
  rollPeriod(ledger.account, now);
  if (input.estimateTokens < 1) return { ok: false as const, code: "empty" as const, account: ledger.account };
  if (remainingTokens(ledger.account, now) < input.estimateTokens) {
    return { ok: false as const, code: "allowance-exhausted" as const, account: ledger.account };
  }
  ledger.account.reservedTokens += input.estimateTokens;
  const operation: Operation = {
    operationId: input.operationId,
    kind: input.kind,
    status: "reserved",
    estimateTokens: input.estimateTokens,
    actualTokens: 0,
    providerRequestId: "",
    usageSource: "estimate",
  };
  ledger.operations.set(input.operationId, operation);
  return { ok: true as const, duplicate: false, operation, account: ledger.account };
}

function consume(account: Account, amount: number, now: Date) {
  let left = amount;
  const includedLeft = account.status === "canceled" && now.toISOString() >= account.periodEnd
    ? 0
    : Math.max(0, account.includedTokens - account.includedUsedTokens);
  const fromIncluded = Math.min(includedLeft, left);
  account.includedUsedTokens += fromIncluded;
  left -= fromIncluded;
  if (left > 0 && now.toISOString() < account.purchasedExpires) {
    const purchasedLeft = Math.max(0, account.purchasedTokens - account.purchasedUsedTokens);
    const fromPurchased = Math.min(purchasedLeft, left);
    account.purchasedUsedTokens += fromPurchased;
    left -= fromPurchased;
  }
  return left;
}

export function reconcile(ledger: Ledger, input: { operationId: string; actualTokens: number; providerRequestId?: string; usageSource?: "provider" | "estimate" }, now = new Date()) {
  const providerRequestId = String(input.providerRequestId || "");
  if (providerRequestId && ledger.providerIds.has(providerRequestId)) {
    return { ok: true as const, duplicate: true, operation: ledger.operations.get(ledger.providerIds.get(providerRequestId) || "") };
  }
  const operation = ledger.operations.get(input.operationId);
  if (!operation) return { ok: false as const, code: "unknown-operation" as const };
  if (operation.status === "reconciled") return { ok: true as const, duplicate: true, operation };
  if (operation.status !== "reserved") return { ok: false as const, code: "not-reserved" as const };
  ledger.account.reservedTokens = Math.max(0, ledger.account.reservedTokens - operation.estimateTokens);
  const unpaid = consume(ledger.account, input.actualTokens, now);
  operation.actualTokens = input.actualTokens - unpaid;
  operation.status = "reconciled";
  operation.providerRequestId = providerRequestId;
  operation.usageSource = input.usageSource || "estimate";
  if (providerRequestId) ledger.providerIds.set(providerRequestId, input.operationId);
  return { ok: true as const, duplicate: false, operation, unbilledTokens: unpaid };
}

export function cancelReservation(ledger: Ledger, operationId: string) {
  const operation = ledger.operations.get(operationId);
  if (!operation) return { ok: false as const, code: "unknown-operation" as const };
  if (operation.status === "canceled") return { ok: true as const, duplicate: true };
  if (operation.status !== "reserved") return { ok: false as const, code: "not-reserved" as const };
  ledger.account.reservedTokens = Math.max(0, ledger.account.reservedTokens - operation.estimateTokens);
  operation.status = "canceled";
  return { ok: true as const, duplicate: false };
}

export function refundOperation(ledger: Ledger, operationId: string) {
  const operation = ledger.operations.get(operationId);
  if (!operation) return { ok: false as const, code: "unknown-operation" as const };
  if (operation.status === "refunded") return { ok: true as const, duplicate: true };
  if (operation.status !== "reconciled") return { ok: false as const, code: "not-reconciled" as const };
  let left = operation.actualTokens;
  const fromPurchased = Math.min(ledger.account.purchasedUsedTokens, left);
  ledger.account.purchasedUsedTokens -= fromPurchased;
  left -= fromPurchased;
  ledger.account.includedUsedTokens = Math.max(0, ledger.account.includedUsedTokens - left);
  operation.status = "refunded";
  return { ok: true as const, duplicate: false };
}

export function rollPeriod(account: Account, now: Date, plan = TEST_PLAN) {
  if (now.toISOString() < account.periodEnd) return false;
  account.includedUsedTokens = 0;
  account.reservedTokens = 0;
  account.periodStart = account.periodEnd;
  account.periodEnd = new Date(new Date(account.periodEnd).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  account.includedTokens = plan.includedTokens;
  return true;
}

export type Purchase = {
  id: string;
  advisorId: string;
  packId: string;
  priceCadCents: number;
  taxCadCents: number;
  totalCadCents: number;
  tokens: number;
  expiresAt: string;
  status: "agreed" | "paid" | "canceled" | "refunded";
  termsVersion: number;
};

export function paymentConfigured() {
  return process.env.BILLING_PAYMENT_PROVIDER === "test";
}

export function testSignature(raw: string, secret = process.env.BILLING_TEST_WEBHOOK_SECRET || "test-only-not-a-live-secret") {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

export function signatureMatches(raw: string, header: string) {
  const expected = testSignature(raw);
  const given = Buffer.from(String(header || ""));
  const actual = Buffer.from(expected);
  return given.length === actual.length && timingSafeEqual(given, actual);
}

export type PaymentEvent = { id: string; type: "paid" | "failed" | "canceled" | "refunded"; purchaseId: string; advisorId: string };

export function applyPaymentEvent(input: {
  purchases: Map<string, Purchase>;
  events: Map<string, string>;
  account: Account;
  event: PaymentEvent;
  now: Date;
}) {
  if (input.events.has(input.event.id)) return { ok: true as const, duplicate: true, credited: false };
  const purchase = input.purchases.get(input.event.purchaseId);
  if (!purchase || purchase.advisorId !== input.event.advisorId || purchase.advisorId !== input.account.advisorId) {
    return { ok: false as const, code: "wrong-owner" as const, credited: false };
  }
  input.events.set(input.event.id, input.event.type);
  if (input.event.type === "paid") {
    if (purchase.status === "paid") return { ok: true as const, duplicate: true, credited: false };
    if (purchase.status !== "agreed") return { ok: false as const, code: "not-agreed" as const, credited: false };
    purchase.status = "paid";
    input.account.purchasedTokens += purchase.tokens;
    input.account.purchasedExpires = purchase.expiresAt;
    return { ok: true as const, duplicate: false, credited: true };
  }
  if (input.event.type === "failed" || input.event.type === "canceled") {
    if (purchase.status === "agreed") purchase.status = "canceled";
    return { ok: true as const, duplicate: false, credited: false };
  }
  if (purchase.status !== "paid") return { ok: true as const, duplicate: false, credited: false, pending: true };
  const unused = Math.max(0, input.account.purchasedTokens - input.account.purchasedUsedTokens);
  const remove = Math.min(unused, purchase.tokens);
  input.account.purchasedTokens -= remove;
  purchase.status = "refunded";
  return { ok: true as const, duplicate: false, credited: false, refundedTokens: remove };
}

export function agreePurchase(advisorId: string, plan = TEST_PLAN, now = new Date()): Purchase | { ok: false; error: string } {
  const quote = packQuote(plan);
  if (!plan.pricesApproved || quote.priceCadCents == null || quote.taxCadCents == null || quote.totalCadCents == null || quote.tokens == null || !quote.validityDays) {
    return { ok: false, error: "Pricing is not set. Checkout is off. No purchase was created." };
  }
  if (!paymentConfigured()) {
    return { ok: false, error: "No payment provider is configured. The test adapter is implemented but not turned on. No purchase was created." };
  }
  const expires = new Date(now.getTime() + plan.packValidityDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: `test_${randomUUID()}`,
    advisorId,
    packId: quote.packId,
    priceCadCents: quote.priceCadCents,
    taxCadCents: quote.taxCadCents,
    totalCadCents: quote.totalCadCents,
    tokens: quote.tokens,
    expiresAt: expires,
    status: "agreed",
    termsVersion: plan.version,
  };
}

export function browserReturnCreditsBalance() {
  return false;
}

export function alterPurchaseTerms() {
  return { ok: false as const, error: "Purchased pack terms cannot be changed after the advisor agrees." };
}

export type PlanChange = { version: number; document: PlanDocument; effectiveAt: string };

export function schedulePlanChange(current: PlanDocument, next: Partial<PlanDocument>, effectiveAt: string): PlanChange {
  return {
    version: current.version + 1,
    effectiveAt,
    document: { ...current, ...next, version: current.version + 1, effectiveAt, formFill: false, premiumModel: false },
  };
}

export const ALLOWANCE_STOP = "A technical safety limit paused new AI replies. Drafts and the desk stay available. Pricing is not set, checkout is off, and nothing was charged.";

type BillingSql = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<T[]>;
};

let billingTables: Promise<void> | null = null;

export function ensureBillingTables(sql: BillingSql) {
  billingTables ||= sql.query(`
    create table if not exists advisor_billing_state (
      advisor_id text primary key,
      version int not null default 1,
      ledger jsonb not null,
      purchases jsonb not null default '[]'::jsonb,
      events jsonb not null default '[]'::jsonb,
      plan_versions jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now()
    );
  `).then(() => undefined);
  return billingTables;
}

type Stored = { account: Account; operations: Operation[]; providerIds: Array<[string, string]> };

function asStored(value: unknown): Stored {
  const parsed = typeof value === "string" ? JSON.parse(value) as Stored : value as Stored;
  return {
    account: parsed.account,
    operations: parsed.operations || [],
    providerIds: parsed.providerIds || [],
  };
}

function toLedger(stored: Stored): Ledger {
  const account = stored.account;
  if (typeof account.includedTokens !== "number") {
    const fresh = openAccount(account.advisorId || "advisor", new Date());
    fresh.status = account.status === "canceled" ? "canceled" : "active";
    fresh.periodStart = account.periodStart || fresh.periodStart;
    fresh.periodEnd = account.periodEnd || fresh.periodEnd;
    stored = { ...stored, account: fresh };
  }
  return {
    account: stored.account,
    operations: new Map((stored.operations || []).map((item) => [item.operationId, item])),
    providerIds: new Map(stored.providerIds || []),
  };
}

function fromLedger(ledger: Ledger): Stored {
  return {
    account: ledger.account,
    operations: [...ledger.operations.values()],
    providerIds: [...ledger.providerIds.entries()],
  };
}

async function loadState(sql: BillingSql, advisorId: string, now: Date) {
  await ensureBillingTables(sql);
  const rows = await sql.query<{ version: number; ledger: Stored; purchases: Purchase[]; events: Array<[string, string]>; plan_versions: PlanChange[] }>(
    "select version, ledger, purchases, events, plan_versions from advisor_billing_state where advisor_id = $1",
    [advisorId],
  );
  const row = rows[0];
  if (!row) {
    const ledger = { account: openAccount(advisorId, now), operations: new Map(), providerIds: new Map() };
    await sql.query(
      "insert into advisor_billing_state (advisor_id, ledger, purchases, events, plan_versions) values ($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb) on conflict (advisor_id) do nothing",
      [advisorId, JSON.stringify(fromLedger(ledger))],
    );
    return loadState(sql, advisorId, now);
  }
  const ledger = toLedger(asStored(row.ledger));
  rollPeriod(ledger.account, now);
  return { version: Number(row.version), ledger, purchases: new Map((row.purchases || []).map((item) => [item.id, item])), events: new Map(row.events || []), plans: row.plan_versions || [] };
}

async function saveState(sql: BillingSql, advisorId: string, version: number, ledger: Ledger, purchases: Map<string, Purchase>, events: Map<string, string>, plans: PlanChange[]) {
  const rows = await sql.query(
    `update advisor_billing_state
     set version = version + 1, ledger = $3::jsonb, purchases = $4::jsonb, events = $5::jsonb, plan_versions = $6::jsonb, updated_at = now()
     where advisor_id = $1 and version = $2
     returning version`,
    [advisorId, version, JSON.stringify(fromLedger(ledger)), JSON.stringify([...purchases.values()]), JSON.stringify([...events.entries()]), JSON.stringify(plans)],
  );
  return Boolean(rows[0]);
}

export async function withBilling<T>(sql: BillingSql, advisorId: string, now: Date, change: (state: { ledger: Ledger; purchases: Map<string, Purchase>; events: Map<string, string>; plans: PlanChange[] }) => T) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await loadState(sql, advisorId, now);
    const result = change(state);
    const saved = await saveState(sql, advisorId, state.version, state.ledger, state.purchases, state.events, state.plans);
    if (saved) return result;
  }
  throw new Error("The usage update conflicted with another job. Nothing extra was reserved.");
}

export function accountView(account: Account, plan = TEST_PLAN, now = new Date()) {
  return {
    pricing: plan.pricesApproved ? "configured" as const : "unset" as const,
    checkout: "disabled" as const,
    planLabel: plan.pricesApproved ? plan.label : "Pricing is not set",
    currency: null,
    subscription: null,
    topUp: null,
    measuredTokens: account.includedUsedTokens,
    stopped: remainingTokens(account, now) <= 0,
    warnings: usageWarnings(account, plan),
    resetAt: account.periodEnd,
    charging: false,
    paymentConfigured: false,
    paymentNote: "Pricing, currency, and the included allowance are not set. Checkout is off. Nothing can be charged.",
  };
}

