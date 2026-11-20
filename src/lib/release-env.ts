import { resolve } from "node:path";

/** Directories this release process must never open. */
export const FORBIDDEN_DATA_DIRS = [
  "/workspace/.preview-data/pglite-isolated-test-20261118",
  "/workspace/.preview-data/pglite-untouched-20261119",
  "/workspace/.preview-data/pglite",
  "/workspace/.preview-data/pglite-work",
];

export const ACCEPTANCE_SOURCE = "/workspace";
export const ACCEPTANCE_PORT = 8080;

export function releaseEnv(): "development" | "staging" | "" {
  const value = process.env.UA_RELEASE_ENV;
  if (value === "development" || value === "staging") return value;
  return "";
}

export function assertReleaseDatabase(dir: string) {
  if (!releaseEnv()) return;
  const resolved = resolve(dir);
  for (const forbidden of FORBIDDEN_DATA_DIRS) {
    const blocked = resolve(forbidden);
    if (resolved === blocked || resolved.startsWith(`${blocked}/`)) {
      throw new Error(`Release environment refuses ${resolved}.`);
    }
  }
  const root = process.env.UA_RELEASE_DATA_ROOT?.trim();
  if (!root) throw new Error("UA_RELEASE_ENV requires UA_RELEASE_DATA_ROOT.");
  const allowed = resolve(root);
  if (resolved !== allowed && !resolved.startsWith(`${allowed}/`)) {
    throw new Error(`Release database ${resolved} is outside ${allowed}.`);
  }
  if (process.env.DATABASE_URL?.trim()) {
    throw new Error("Release environment refuses a hosted DATABASE_URL.");
  }
}

export function assertReleaseProcess(input: { cwd: string; port: number }) {
  const cwd = resolve(input.cwd);
  if (cwd === resolve(ACCEPTANCE_SOURCE) || cwd.startsWith(`${resolve(ACCEPTANCE_SOURCE)}/`)) {
    throw new Error("A release process must not use the acceptance source tree.");
  }
  if (input.port === ACCEPTANCE_PORT) {
    throw new Error("Port 8080 is reserved for the acceptance desk.");
  }
}
