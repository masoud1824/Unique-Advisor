import { runWindow, zonedParts } from "./birthday-job.ts";
import { budgetOpen } from "./hosted-runtime.ts";

/** Quarter-hour schedule so 30- and 45-minute time zones still hit local 9:00. */
export const HOSTED_CRON = "0,15,30,45 * * * *";

export function scheduleCoversQuarterHours(expression: string) {
  const field = expression.trim().split(/\s+/)[0] || "";
  if (field === "*" || field === "*/5" || field === "*/15") return true;
  const parts = new Set(field.split(","));
  return ["0", "15", "30", "45"].every((minute) => parts.has(minute));
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
 * A tick dispatches durable jobs. Provider calls stay in the injected adapters.
 * Outbound blocking and a closed budget fail closed inside the dispatcher.
 * `send: true` only means an injected provider may be called. The HTTP tick
 * does not attach one, so it does not send.
 */
export function tickDecision(input: { outboundBlocked: boolean; executeRequested: boolean; duplicate: boolean }) {
  if (input.duplicate) {
    return { status: "already-claimed", send: false, detail: "This job was already claimed. It was not sent again." };
  }
  if (!budgetOpen("mail") || !budgetOpen("signature")) {
    return { status: "budget-halt", send: false, detail: "A budget switch is on. Nothing was sent." };
  }
  if (input.outboundBlocked) {
    return { status: "blocked", send: false, detail: "Outbound is blocked. Jobs stop at the provider boundary. Nothing was sent." };
  }
  if (!input.executeRequested) {
    return { status: "dispatch-without-provider", send: false, detail: "The scheduler can claim jobs. No live provider is attached, so nothing was sent." };
  }
  return { status: "dispatch", send: true, detail: "The claimed job may call its injected provider once." };
}

