/** Server-side gate for the reconstructed Nov 18 test desk. No database import. */

export const ISOLATED_TEST_DIR = "/workspace/.preview-data/pglite-isolated-test-20261118";

export const ISOLATED_TEST_BANNER =
  "ISOLATED TEST COPY — reconstructed practice data, not recovered original data.";

export const ISOLATED_EXTERNAL_BLOCK =
  "This is an isolated test copy. External email, signature, calendar, campaign, and storage writes are off. Nothing was sent, booked, signed, or changed at a provider.";

export function isolatedTestRequested() {
  return process.env.UA_ISOLATED_TEST === "1";
}

export function isolatedDataDir() {
  return (process.env.PGLITE_DATA_DIR || "").trim().replace(/\/+$/, "");
}

/** Staging may store an advisor's own sign-in. Sends, bookings, and uploads stay blocked. */
export function connectionSetupBlocked() {
  return isolatedTestRequested() && isolatedDataDir() === ISOLATED_TEST_DIR;
}

/** True only when this process was started as the isolated test desk, or when this host must not call providers. */
export function externalSideEffectsBlocked() {
  if (process.env.UA_OUTBOUND_BLOCK === "1") return true;
  const release = process.env.UA_RELEASE_ENV;
  if (release === "development" || release === "staging") return true;
  const host = process.env.UA_HOST_ENV;
  if (host === "development" || host === "staging") return true;
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "preview" || vercelEnv === "development") return true;
  return isolatedTestRequested() && isolatedDataDir() === ISOLATED_TEST_DIR;
}

/**
 * Refuse the wrong directory before any engine open.
 * Isolation mode may open only the new test copy.
 * The test copy may not be opened unless isolation mode is on.
 */
export function refusePreviewDataDir(dir: string): string | null {
  const normalized = (dir || "").trim().replace(/\/+$/, "");
  if (isolatedTestRequested()) {
    if (normalized !== ISOLATED_TEST_DIR) {
      return "Isolated test mode refuses to open any database except the isolated test copy.";
    }
    return null;
  }
  if (normalized === ISOLATED_TEST_DIR) {
    return "The isolated test copy cannot be opened without test isolation.";
  }
  return null;
}

/** Wording for a stored provider link that this copy will not contact. */
export function isolatedProviderNotice(kind: "dropbox" | "mailbox", stored: boolean | null) {
  if (kind === "mailbox") {
    if (stored === null) return "The mailbox was not contacted. This isolated test copy does not call the mailbox, and the saved connection could not be checked. Nothing was sent.";
    if (stored) return "A mailbox connection is still stored. This isolated test copy will not contact the mailbox. Nothing was sent.";
    return "This advisor has no connected mailbox. Nothing was sent.";
  }
  if (stored === null) return "Dropbox was not contacted. This isolated test copy does not call Dropbox, and the saved connection could not be checked. Nothing was sent.";
  if (stored) return "Dropbox is still linked on this desk. This isolated test copy will not contact Dropbox. Nothing was sent.";
  return "Dropbox is not connected. Nothing was sent.";
}
