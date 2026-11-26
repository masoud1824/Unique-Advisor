import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** Test commercial settings. These are not a published price and do not charge a card. */
export const TEST_FX_NOTE = "Test conversion only: 1 USD = 1.40 CAD. This is not a live exchange rate.";
export const TEST_TAX_NOTE = "Test tax only: 13% labelled as HST. This is not a filed tax charge.";

export const TEST_RATES = {
  label: "Test metering rates, not an OpenAI price list",
  textInputUsdMicrosPerMillion: 2_500_000,
  textOutputUsdMicrosPerMillion: 10_000_000,
  speechUsdMicrosPerMillionChars: 15_000_000,
  toolUsdMicros: 10_000,
  jobUsdMicros: 20_000,
};

export type PlanDocument = {
  version: number;
  id: string;
  label: string;
  currency: "CAD";
  subscriptionCadCents: number;
  includedUsdMicros: number;
  packId: string;
  packCadCents: number;
  packUsdMicros: number;
  packValidityDays: number;
  taxRate: number;
  warnAt: number[];
  formFill: false;
  effectiveAt: string;
};

export const TEST_PLAN: PlanDocument = {
  version: 1,
  id: "ua-v1-test",
  label: "TEST PLAN — not a final subscription price",
  currency: "CAD",
  subscriptionCadCents: 2500,
  includedUsdMicros: 6_000_000,
  packId: "ua-extra-test",
  packCadCents: 800,
  packUsdMicros: 3_000_000,
  packValidityDays: 365,
  taxRate: 0.13,
  warnAt: [0.8, 1],
  formFill: false,
  effectiveAt: "2026-11-26T00:00:00.000Z",
};

export type UsageExample = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  speeches: number;
  speechChars: number;
  toolCalls: number;
  jobs: number;
};

/** A modest v1 month used to size the included allowance. */
export const SAMPLE_MONTH: UsageExample = {
  turns: 200,
  inputTokens: 1200,
  outputTokens: 350,
  speeches: 40,
  speechChars: 600,
  toolCalls: 80,
  jobs: 20,
};

export function providerCostUsdMicros(example: UsageExample, rates = TEST_RATES) {
  const input = example.turns * example.inputTokens;
  const output = example.turns * example.outputTokens;
  const speech = example.speeches * example.speechChars;
  return Math.round(input / 1_000_000 * rates.textInputUsdMicrosPerMillion)
    + Math.round(output / 1_000_000 * rates.textOutputUsdMicrosPerMillion)
    + Math.round(speech / 1_000_000 * rates.speechUsdMicrosPerMillionChars)
    + example.toolCalls * rates.toolUsdMicros
    + example.jobs * rates.jobUsdMicros;
}

export function recommendAllowance(plan = TEST_PLAN, example = SAMPLE_MONTH) {
  const providerUsdMicros = providerCostUsdMicros(example);
  const providerCadCents = Math.ceil(providerUsdMicros / 1_000_000 * 1.4 * 100);
  const includedCadCents = Math.ceil(plan.includedUsdMicros / 1_000_000 * 1.4 * 100);
  const paymentFeeCadCents = Math.ceil(plan.subscriptionCadCents * 0.029) + 30;
  const hostingCadCents = 400;
  const roomCadCents = plan.subscriptionCadCents - paymentFeeCadCents - hostingCadCents - includedCadCents;
  return {
    providerUsdMicros,
    providerCadCents,
    includedUsdMicros: plan.includedUsdMicros,
    includedCadCents,
    subscriptionCadCents: plan.subscriptionCadCents,
    paymentFeeCadCents,
    hostingCadCents,
    roomCadCents,
    fx: TEST_FX_NOTE,
    rates: TEST_RATES.label,
    fitsSample: providerUsdMicros <= plan.includedUsdMicros,
    leavesRoom: roomCadCents > 0,
  };
}

export function packQuote(plan = TEST_PLAN) {
  const taxCadCents = Math.round(plan.packCadCents * plan.taxRate);
  return {
    testValues: true,
    quantity: 1,
    packId: plan.packId,
    currency: plan.currency,
    priceCadCents: plan.packCadCents,
    taxCadCents,
    totalCadCents: plan.packCadCents + taxCadCents,
    usdMicros: plan.packUsdMicros,
    validityDays: plan.packValidityDays,
    taxNote: TEST_TAX_NOTE,
    fx: TEST_FX_NOTE,
  };
}

export type Account = {
  advisorId: string;
  planVersion: number;
  status: "active" | "canceled";
  periodStart: string;
  periodEnd: string;
  includedUsdMicros: number;
  includedUsedUsdMicros: number;
  purchasedUsdMicros: number;
  purchasedUsedUsdMicros: number;
  purchasedExpires: string;
  reservedUsdMicros: number;
};

export type Operation = {
  operationId: string;
  kind: string;
  status: "reserved" | "reconciled" | "canceled" | "refunded";
  estimateUsdMicros: number;
  actualUsdMicros: number;
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
    includedUsdMicros: plan.includedUsdMicros,
    includedUsedUsdMicros: 0,
    purchasedUsdMicros: 0,
    purchasedUsedUsdMicros: 0,
    purchasedExpires: start,
    reservedUsdMicros: 0,
    };
}

export function remainingUsdMicros(account: Account, now = new Date()) {
  const included = account.status === "canceled" && now.toISOString() >= account.periodEnd
    ? 0
    : Math.max(0, account.includedUsdMicros - account.includedUsedUsdMicros);
  const purchased = now.toISOString() < account.purchasedExpires
    ? Math.max(0, account.purchasedUsdMicros - account.purchasedUsedUsdMicros)
    : 0;
  return Math.max(0, included + purchased - account.reservedUsdMicros);
}

export function usageRatio(account: Account) {
  const included = Math.max(1, account.includedUsdMicros);
  return account.includedUsedUsdMicros / included;
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

export function reserve(ledger: Ledger, input: { operationId: string; kind: string; estimateUsdMicros: number }, now = new Date()) {
  const existing = ledger.operations.get(input.operationId);
  if (existing) return { ok: true as const, duplicate: true, operation: existing, account: ledger.account };
  rollPeriod(ledger.account, now);
  if (input.estimateUsdMicros < 1) return { ok: false as const, code: "empty" as const, account: ledger.account };
  if (remainingUsdMicros(ledger.account, now) < input.estimateUsdMicros) {
    return { ok: false as const, code: "allowance-exhausted" as const, account: ledger.account };
  }
  ledger.account.reservedUsdMicros += input.estimateUsdMicros;
  const operation: Operation = {
    operationId: input.operationId,
    kind: input.kind,
    status: "reserved",
    estimateUsdMicros: input.estimateUsdMicros,
    actualUsdMicros: 0,
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
    : Math.max(0, account.includedUsdMicros - account.includedUsedUsdMicros);
  const fromIncluded = Math.min(includedLeft, left);
  account.includedUsedUsdMicros += fromIncluded;
  left -= fromIncluded;
  if (left > 0 && now.toISOString() < account.purchasedExpires) {
    const purchasedLeft = Math.max(0, account.purchasedUsdMicros - account.purchasedUsedUsdMicros);
    const fromPurchased = Math.min(purchasedLeft, left);
    account.purchasedUsedUsdMicros += fromPurchased;
    left -= fromPurchased;
  }
  return left;
}

export function reconcile(ledger: Ledger, input: { operationId: string; actualUsdMicros: number; providerRequestId?: string; usageSource?: "provider" | "estimate" }, now = new Date()) {
  const providerRequestId = String(input.providerRequestId || "");
  if (providerRequestId && ledger.providerIds.has(providerRequestId)) {
    return { ok: true as const, duplicate: true, operation: ledger.operations.get(ledger.providerIds.get(providerRequestId) || "") };
  }
  const operation = ledger.operations.get(input.operationId);
  if (!operation) return { ok: false as const, code: "unknown-operation" as const };
  if (operation.status === "reconciled") return { ok: true as const, duplicate: true, operation };
  if (operation.status !== "reserved") return { ok: false as const, code: "not-reserved" as const };
  ledger.account.reservedUsdMicros = Math.max(0, ledger.account.reservedUsdMicros - operation.estimateUsdMicros);
  const unpaid = consume(ledger.account, input.actualUsdMicros, now);
  operation.actualUsdMicros = input.actualUsdMicros - unpaid;
  operation.status = "reconciled";
  operation.providerRequestId = providerRequestId;
  operation.usageSource = input.usageSource || "estimate";
  if (providerRequestId) ledger.providerIds.set(providerRequestId, input.operationId);
  return { ok: true as const, duplicate: false, operation, unbilledUsdMicros: unpaid };
}

export function cancelReservation(ledger: Ledger, operationId: string) {
  const operation = ledger.operations.get(operationId);
  if (!operation) return { ok: false as const, code: "unknown-operation" as const };
  if (operation.status === "canceled") return { ok: true as const, duplicate: true };
  if (operation.status !== "reserved") return { ok: false as const, code: "not-reserved" as const };
  ledger.account.reservedUsdMicros = Math.max(0, ledger.account.reservedUsdMicros - operation.estimateUsdMicros);
  operation.status = "canceled";
  return { ok: true as const, duplicate: false };
}

export function refundOperation(ledger: Ledger, operationId: string) {
  const operation = ledger.operations.get(operationId);
  if (!operation) return { ok: false as const, code: "unknown-operation" as const };
  if (operation.status === "refunded") return { ok: true as const, duplicate: true };
  if (operation.status !== "reconciled") return { ok: false as const, code: "not-reconciled" as const };
  let left = operation.actualUsdMicros;
  const fromPurchased = Math.min(ledger.account.purchasedUsedUsdMicros, left);
  ledger.account.purchasedUsedUsdMicros -= fromPurchased;
  left -= fromPurchased;
  ledger.account.includedUsedUsdMicros = Math.max(0, ledger.account.includedUsedUsdMicros - left);
  operation.status = "refunded";
  return { ok: true as const, duplicate: false };
}

export function rollPeriod(account: Account, now: Date, plan = TEST_PLAN) {
  if (now.toISOString() < account.periodEnd) return false;
  account.includedUsedUsdMicros = 0;
  account.reservedUsdMicros = 0;
  account.periodStart = account.periodEnd;
  account.periodEnd = new Date(new Date(account.periodEnd).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  account.includedUsdMicros = plan.includedUsdMicros;
  return true;
}

export type Purchase = {
  id: string;
  advisorId: string;
  packId: string;
  priceCadCents: number;
  taxCadCents: number;
  totalCadCents: number;
  usdMicros: number;
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
    input.account.purchasedUsdMicros += purchase.usdMicros;
    input.account.purchasedExpires = purchase.expiresAt;
    return { ok: true as const, duplicate: false, credited: true };
  }
  if (input.event.type === "failed" || input.event.type === "canceled") {
    if (purchase.status === "agreed") purchase.status = "canceled";
    return { ok: true as const, duplicate: false, credited: false };
  }
  if (purchase.status !== "paid") return { ok: true as const, duplicate: false, credited: false, pending: true };
  const unused = Math.max(0, input.account.purchasedUsdMicros - input.account.purchasedUsedUsdMicros);
  const remove = Math.min(unused, purchase.usdMicros);
  input.account.purchasedUsdMicros -= remove;
  purchase.status = "refunded";
  return { ok: true as const, duplicate: false, credited: false, refundedUsdMicros: remove };
}

export function agreePurchase(advisorId: string, plan = TEST_PLAN, now = new Date()): Purchase | { ok: false; error: string } {
  if (!paymentConfigured()) {
    return { ok: false, error: "No payment provider is configured. The test adapter is implemented but not turned on. No purchase was created." };
  }
  const quote = packQuote(plan);
  const expires = new Date(now.getTime() + plan.packValidityDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: `test_${randomUUID()}`,
    advisorId,
    packId: quote.packId,
    priceCadCents: quote.priceCadCents,
    taxCadCents: quote.taxCadCents,
    totalCadCents: quote.totalCadCents,
    usdMicros: quote.usdMicros,
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
    document: { ...current, ...next, version: current.version + 1, effectiveAt, formFill: false },
  };
}

export const ALLOWANCE_STOP = "The included AI allowance is used up. Drafts and the desk stay available. AI replies, voice, and scheduled automation are paused. No extra charge was made.";

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
  return {
    account: stored.account,
    operations: new Map(stored.operations.map((item) => [item.operationId, item])),
    providerIds: new Map(stored.providerIds),
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
  const quote = packQuote(plan);
  return {
    testValues: true,
    planLabel: plan.label,
    currency: plan.currency,
    subscriptionCadCents: plan.subscriptionCadCents,
    includedUsdMicros: account.includedUsdMicros,
    usedUsdMicros: account.includedUsedUsdMicros,
    remainingUsdMicros: remainingUsdMicros(account, now),
    purchasedUsdMicros: Math.max(0, account.purchasedUsdMicros - account.purchasedUsedUsdMicros),
    purchasedExpires: account.purchasedExpires,
    periodStart: account.periodStart,
    resetAt: account.periodEnd,
    warnings: usageWarnings(account, plan),
    stopped: remainingUsdMicros(account, now) <= 0,
    quote,
    charging: false,
    paymentConfigured: paymentConfigured(),
    paymentNote: paymentConfigured() ? "Test payment adapter only. No live charge." : "No payment provider is configured. No purchase can be completed.",
  };
}

