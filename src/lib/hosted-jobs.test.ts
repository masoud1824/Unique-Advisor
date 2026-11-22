import assert from "node:assert/strict";
import test from "node:test";
import { advisorBirthdayWindow, dripDue, tickDecision, tickRunKey, tickSlot } from "./hosted-jobs.ts";
import { assertHostedDatabaseConfigured } from "./hosted-runtime.ts";

test("America/Toronto 9:00 is the winter and summer UTC hour, including the DST change", () => {
  const winter = advisorBirthdayWindow(new Date("2026-01-15T14:00:00.000Z"), "America/Toronto", "");
  assert.equal(winter.local.hour, "09");
  assert.equal(winter.window, "run");
  const summer = advisorBirthdayWindow(new Date("2026-07-15T13:00:00.000Z"), "America/Toronto", "");
  assert.equal(summer.local.hour, "09");
  assert.equal(summer.window, "run");
  const summerWrongHour = advisorBirthdayWindow(new Date("2026-07-15T14:00:00.000Z"), "America/Toronto", "2026-07-14");
  assert.equal(summerWrongHour.local.hour, "10");
  assert.equal(summerWrongHour.window, "run");
  const tooSoon = advisorBirthdayWindow(new Date("2026-07-15T12:30:00.000Z"), "America/Toronto", "");
  assert.equal(tooSoon.window, "too_early");
});

test("an inactive drip is not due, and a past next_at is", () => {
  const now = Date.parse("2026-11-21T14:00:00.000Z");
  assert.equal(dripDue({ active: false, nextAt: null, nowMs: now }), false);
  assert.equal(dripDue({ active: true, nextAt: null, nowMs: now }), true);
  assert.equal(dripDue({ active: true, nextAt: "2026-11-21T13:00:00.000Z", nowMs: now }), true);
  assert.equal(dripDue({ active: true, nextAt: "2026-11-21T15:00:00.000Z", nowMs: now }), false);
});

test("hosted mode refuses PGLite when DATABASE_URL is missing", () => {
  const plane = process.env.UA_DATA_PLANE;
  const url = process.env.DATABASE_URL;
  process.env.UA_DATA_PLANE = "postgres";
  delete process.env.DATABASE_URL;
  assert.throws(() => assertHostedDatabaseConfigured(), /PGLite is not used for hosted data/);
  if (plane === undefined) delete process.env.UA_DATA_PLANE;
  else process.env.UA_DATA_PLANE = plane;
  if (url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = url;
});

test("the same UTC hour is one job record, and this build does not send", () => {
  const now = new Date("2026-11-21T14:05:00.000Z");
  assert.equal(tickSlot(now), "2026-11-21T14");
  assert.equal(tickRunKey(tickSlot(now)), "tick:2026-11-21T14");
  assert.equal(tickDecision({ outboundBlocked: true, executeRequested: true, duplicate: false }).send, false);
  assert.equal(tickDecision({ outboundBlocked: false, executeRequested: true, duplicate: false }).status, "execute-not-wired");
  assert.equal(tickDecision({ outboundBlocked: false, executeRequested: true, duplicate: true }).status, "duplicate");
});
