import { createHash, timingSafeEqual } from "node:crypto";

export function hashCode(code: string) {
  return createHash("sha256").update(code.trim()).digest("hex");
}

export function codesMatch(stored: string, given: string) {
  const left = String(stored ?? "").trim().toLowerCase();
  const right = hashCode(given);
  if (!left || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
