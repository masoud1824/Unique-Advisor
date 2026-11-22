import { runWindow, zonedParts } from "./birthday-job.ts";
import { budgetOpen } from "./hosted-runtime.ts";

/** Hour slot in UTC. A second invocation in the same hour is a duplicate, not a second send. */
export function tickSlot(now: Date) {
  return now.toISOString().slice(0, 13);
}

export function tickRunKey(slot: string) {
  return `tick:${slot}`;
}

export function advisorBirthdayWindow(now: Date, timeZone: string, lastRunDate: string) {
  const local = zonedParts(now, timeZone || "America/Toronto");
  return { local, window: runWindow(local, lastRunDate) };
}

export function dripDue(input: { active: boolean; nextAt: string | null; nowMs: number }) {
  if (!input.active) return false;
  if (!input.nextAt) return true;
  const at = Date.parse(input.nextAt);
  return Number.isFinite(at) && at <= input.nowMs;
}

/**
 * The tick may record due work while the desk is closed.
 * This preparation build never turns the record into a provider call.
 */
export function tickDecision(input: { outboundBlocked: boolean; executeRequested: boolean; duplicate: boolean }) {
  if (input.duplicate) {
    return { status: "duplicate", send: false, detail: "This hour was already recorded. Nothing was sent again." };
  }
  if (!budgetOpen("mail") || !budgetOpen("signature")) {
    return { status: "budget-halt", send: false, detail: "A budget switch is on. Nothing was sent." };
  }
  if (input.outboundBlocked || !input.executeRequested) {
    return { status: "planned", send: false, detail: "Due work can be recorded while the desk is closed. Nothing was sent." };
  }
  return {
    status: "execute-not-wired",
    send: false,
    detail: "Live provider execution is not connected in this preparation build. Nothing was sent.",
  };
}
