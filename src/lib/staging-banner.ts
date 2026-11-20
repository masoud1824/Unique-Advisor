import { ISOLATED_TEST_BANNER } from "./isolated-test-desk.ts";

/** Shown only when this process is the staging practice, never on the acceptance desk. */
export const STAGING_BANNER =
  "STAGING PRACTICE — fictional records only. This is not the tested acceptance desk. Birthday checks are off. Mail and providers are blocked.";

export function deskStatusBanner(site: { isolatedTest?: boolean; releaseLabel?: string } | null | undefined) {
  if (site?.releaseLabel === "staging") {
    return { kind: "staging" as const, text: STAGING_BANNER, background: "#8a4b08" };
  }
  if (site?.isolatedTest) {
    return { kind: "isolated" as const, text: ISOLATED_TEST_BANNER, background: "#7a1f2b" };
  }
  return null;
}
