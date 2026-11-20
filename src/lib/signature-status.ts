export type SignatureProgress = "sent" | "viewed" | "partially_signed" | "completed" | "declined" | "expired" | "failed";

export type ProviderSignature = {
  status_code?: string;
  last_viewed_at?: number | null;
  signed_at?: number | null;
};

export function statusFromProvider(body: {
  is_complete?: boolean;
  is_declined?: boolean;
  has_error?: boolean;
  signatures?: ProviderSignature[];
}): SignatureProgress {
  const signatures = body.signatures || [];
  if (body.has_error) return "failed";
  if (body.is_declined || signatures.some((item) => item.status_code === "declined")) return "declined";
  if (body.is_complete || (signatures.length > 0 && signatures.every((item) => item.status_code === "signed"))) return "completed";
  if (signatures.some((item) => item.status_code === "signed")) return "partially_signed";
  if (signatures.some((item) => item.last_viewed_at)) return "viewed";
  return "sent";
}

export function filesAvailability(status: number) {
  if (status === 409) return "preparing" as const;
  if (status === 429) return "limited" as const;
  if (status >= 200 && status < 300) return "ready" as const;
  return "unavailable" as const;
}

export function nextStatusCheck(input: { attempts: number; httpStatus: number; resetUnix?: number; now: number }) {
  if (input.httpStatus === 429 && input.resetUnix && input.resetUnix * 1000 > input.now) return input.resetUnix * 1000;
  if (input.httpStatus === 409) return input.now + 60_000;
  const step = Math.min(input.attempts, 4);
  return input.now + Math.min(600_000, 60_000 * 2 ** step);
}

export function duplicateRequest(existingFingerprint: string, nextFingerprint: string) {
  return existingFingerprint.length > 0 && existingFingerprint === nextFingerprint;
}

export function statusUrl(requestId: string) {
  return `https://api.hellosign.com/v3/signature_request/${encodeURIComponent(requestId)}`;
}
