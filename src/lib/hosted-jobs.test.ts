import assert from "node:assert/strict";
import test from "node:test";
import { advisorBirthdayWindow, dripDue, HOSTED_CRON, scheduleCoversQuarterHours, tickDecision } from "./hosted-jobs.ts";
import { assertHostedDatabaseConfigured } from "./hosted-runtime.ts";
import { absoluteAppUrl, configuredPublicOrigin, zoomRedirectUri } from "./public-origin.ts";


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

test("scheduled work is not limited to time zones on a whole hour", () => {
  assert.equal(scheduleCoversQuarterHours(HOSTED_CRON), true);
  assert.equal(scheduleCoversQuarterHours("0 * * * *"), false);
  const johns = advisorBirthdayWindow(new Date("2026-01-15T12:30:00.000Z"), "America/St_Johns", "");
  assert.equal(Number(johns.local.hour), 9);
  assert.equal(Number(johns.local.minute), 0);
  assert.equal(johns.window, "run");
  const tooSoon = advisorBirthdayWindow(new Date("2026-01-15T12:00:00.000Z"), "America/St_Johns", "");
  assert.equal(tooSoon.window, "too_early");
  const kathmandu = advisorBirthdayWindow(new Date("2026-01-15T03:15:00.000Z"), "Asia/Kathmandu", "");
  assert.equal(Number(kathmandu.local.hour), 9);
  assert.equal(Number(kathmandu.local.minute), 0);
  assert.equal(kathmandu.window, "run");
});

test("a duplicate tick is not a second send", () => {
  const duplicate = tickDecision({ outboundBlocked: false, executeRequested: true, duplicate: true });
  assert.equal(duplicate.send, false);
  assert.equal(duplicate.status, "already-claimed");
  const blocked = tickDecision({ outboundBlocked: true, executeRequested: true, duplicate: false });
  assert.equal(blocked.send, false);
  assert.equal(blocked.status, "blocked");
  const unattached = tickDecision({ outboundBlocked: false, executeRequested: false, duplicate: false });
  assert.equal(unattached.send, false);
  assert.equal(unattached.status, "dispatch-without-provider");
  const open = tickDecision({ outboundBlocked: false, executeRequested: true, duplicate: false });
  assert.equal(open.status, "dispatch");
  assert.equal(open.send, true);
});

test("links use the configured origin and do not invent a Grok domain", () => {
  const pub = process.env.PUBLIC_APP_URL;
  const auth = process.env.BETTER_AUTH_URL;
  delete process.env.PUBLIC_APP_URL;
  delete process.env.BETTER_AUTH_URL;
  assert.equal(configuredPublicOrigin(), "");
  assert.equal(absoluteAppUrl("/api/book/abc"), "/api/book/abc");
  assert.equal(zoomRedirectUri(), "");
  assert.equal(absoluteAppUrl("/a/staging-practice/site").includes("grok.me"), false);
  process.env.PUBLIC_APP_URL = "http://desk.example";
  assert.equal(configuredPublicOrigin(), "");
  process.env.PUBLIC_APP_URL = "https://desk.example/ignored";
  assert.equal(zoomRedirectUri(), "https://desk.example/api/zoom/callback");
  assert.equal(absoluteAppUrl("/api/meetings/ics?token=abc"), "https://desk.example/api/meetings/ics?token=abc");
  if (pub === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = pub;
  if (auth === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = auth;
});

