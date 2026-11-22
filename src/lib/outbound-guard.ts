import { externalSideEffectsBlocked } from "./isolated-test-desk.ts";
import { budgetOpen } from "./hosted-runtime.ts";

export const OUTBOUND_BLOCKED =
  "Outbound mail, provider calls, and uploads are blocked in this environment. Nothing was sent.";

export const MODEL_OFF =
  "The language model is off in this environment. No model request was made.";

export const MODEL_BUDGET =
  "The model budget is closed. No model request was made.";

/** Blocks provider calls even when DATABASE_URL is set. Release and isolated desks fail closed. */
export function outboundBlocked(): boolean {
  if (process.env.UA_OUTBOUND_BLOCK === "1") return true;
  const release = process.env.UA_RELEASE_ENV;
  if (release === "development" || release === "staging") return true;
  return externalSideEffectsBlocked();
}

/**
 * Chat, transcription, and spoken reply. Separate from mail, signatures,
 * uploads, calendar writes, and campaigns. Off unless this environment is
 * explicitly allowed and the model budget is open. A key alone does not enable it.
 */
export function modelTransportOpen(): { ok: true } | { ok: false; reason: string } {
  if (!budgetOpen("openai")) return { ok: false, reason: MODEL_BUDGET };
  if (process.env.UA_AI_ENABLED !== "1") return { ok: false, reason: MODEL_OFF };
  return { ok: true };
}

export function assertOutboundOpen(): void {
  if (outboundBlocked()) throw new Error(OUTBOUND_BLOCKED);
}
