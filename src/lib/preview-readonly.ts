import { dbSource } from "@/lib/db";
import { externalSideEffectsBlocked } from "@/lib/isolated-test-desk";

export const PREVIEW_WRITE_BLOCK = "This preview is read-only. Nothing was created, changed, deleted, sent, or booked.";

export function previewWritesBlocked() {
  return dbSource === "pglite" || externalSideEffectsBlocked();
}
