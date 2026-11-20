#!/usr/bin/env node
/** Fake-clock birthday check. Refuses live mail. Does not start a timer. */
import { planBirthdayRun } from "../../src/lib/birthday-job.ts";
import { outboundBlocked } from "../../src/lib/outbound-guard.ts";

if (process.env.UA_BIRTHDAY_LIVE === "1") {
  console.error("Refusing a live birthday run. This task does not activate sending.");
  process.exit(2);
}
if (!outboundBlocked()) {
  console.error("Refusing to plan birthdays unless outbound sending is already blocked.");
  process.exit(2);
}
const now = new Date(process.env.UA_BIRTHDAY_NOW || "2026-11-20T14:00:00.000Z");
const plan = planBirthdayRun({
  advisorId: 0,
  settings: {
    enabled: false,
    source: "",
    timezone: process.env.UA_BIRTHDAY_ZONE || "America/Toronto",
    feb29: "skip",
    templateVersion: 1,
    confirmedVersion: 0,
    cardTitle: "",
  },
  people: [],
  claims: [],
  now,
  lastRunDate: "",
});
console.log(JSON.stringify({ live: false, sent: false, notice: plan.notice, recipients: plan.recipients }));
