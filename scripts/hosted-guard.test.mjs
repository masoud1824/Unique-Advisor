import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDisposablePostgresUrl,
  budgetOpen,
  cronAuthorized,
  migrationApproved,
  migrationDatabaseUrl,
  redactPrivate,
} from "./hosted-guard.mjs";

test("production migration stays off until it is explicitly approved", () => {
  const previous = process.env.UA_HOST_ENV;
  const approved = process.env.UA_MIGRATE_APPROVED;
  process.env.UA_HOST_ENV = "production";
  delete process.env.UA_MIGRATE_APPROVED;
  assert.equal(migrationApproved(), false);
  process.env.UA_MIGRATE_APPROVED = "1";
  assert.equal(migrationApproved(), true);
  process.env.UA_HOST_ENV = "staging";
  delete process.env.UA_MIGRATE_APPROVED;
  assert.equal(migrationApproved(), true);
  if (previous === undefined) delete process.env.UA_HOST_ENV;
  else process.env.UA_HOST_ENV = previous;
  if (approved === undefined) delete process.env.UA_MIGRATE_APPROVED;
  else process.env.UA_MIGRATE_APPROVED = approved;
});

test("cron auth rejects a short secret and accepts only the exact bearer", () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "short";
  assert.equal(cronAuthorized("Bearer short"), false);
  process.env.CRON_SECRET = "staging-cron-secret-16";
  assert.equal(cronAuthorized("Bearer staging-cron-secret-16"), true);
  assert.equal(cronAuthorized("Bearer staging-cron-secret-17"), false);
  assert.equal(cronAuthorized(null), false);
  if (previous === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;
});

test("logs drop urls, bearers, and mailbox addresses", () => {
  const text = redactPrivate("postgres://user:secret@db.example/app Bearer abcdefghijklmnop casey.sample@example.invalid");
  assert.equal(text.includes("secret"), false);
  assert.equal(text.includes("casey.sample"), false);
  assert.match(text, /\[redacted\]/);
  assert.match(text, /\[email\]/);
});

test("migration prefers the direct url", () => {
  const pooled = process.env.DATABASE_URL;
  const direct = process.env.DATABASE_URL_UNPOOLED;
  process.env.DATABASE_URL = "postgresql://pooled";
  process.env.DATABASE_URL_UNPOOLED = "postgresql://direct";
  assert.equal(migrationDatabaseUrl(), "postgresql://direct");
  delete process.env.DATABASE_URL_UNPOOLED;
  assert.equal(migrationDatabaseUrl(), "postgresql://pooled");
  if (pooled === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = pooled;
  if (direct === undefined) delete process.env.DATABASE_URL_UNPOOLED;
  else process.env.DATABASE_URL_UNPOOLED = direct;
});

test("budget switches fail closed", () => {
  const previous = process.env.UA_BUDGET_HALT;
  delete process.env.UA_BUDGET_HALT;
  assert.equal(budgetOpen("mail"), true);
  process.env.UA_BUDGET_HALT = "1";
  assert.equal(budgetOpen("mail"), false);
  if (previous === undefined) delete process.env.UA_BUDGET_HALT;
  else process.env.UA_BUDGET_HALT = previous;
});

test("disposable rehearsal refuses remote and non-disposable names", () => {
  const previous = process.env.UA_DISPOSABLE_POSTGRES;
  process.env.UA_DISPOSABLE_POSTGRES = "1";
  assert.throws(() => assertDisposablePostgresUrl("postgresql://user@ep-x.neon.tech/ua_disposable"), /refuses/);
  assert.throws(() => assertDisposablePostgresUrl("postgresql://user@127.0.0.1/postgres"), /ua_disposable/);
  assert.doesNotThrow(() => assertDisposablePostgresUrl("postgresql://user@127.0.0.1:5432/ua_disposable_proof"));
  if (previous === undefined) delete process.env.UA_DISPOSABLE_POSTGRES;
  else process.env.UA_DISPOSABLE_POSTGRES = previous;
});
