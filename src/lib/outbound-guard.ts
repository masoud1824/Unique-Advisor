import { externalSideEffectsBlocked } from "./isolated-test-desk.ts";

export const OUTBOUND_BLOCKED =
  "Outbound mail, provider calls, and uploads are blocked in this environment. Nothing was sent.";

/** Blocks provider calls even when DATABASE_URL is set. Release and isolated desks fail closed. */
export function outboundBlocked(): boolean {
  if (process.env.UA_OUTBOUND_BLOCK === "1") return true;
  const release = process.env.UA_RELEASE_ENV;
  if (release === "development" || release === "staging") return true;
  return externalSideEffectsBlocked();
}

export function assertOutboundOpen(): void {
  if (outboundBlocked()) throw new Error(OUTBOUND_BLOCKED);
}
