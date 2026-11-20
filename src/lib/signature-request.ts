export const UNSUPPORTED_SIGNATURE_PROVIDERS = ["DocuSign", "Adobe Acrobat Sign"] as const;
export const SUPPORTED_STORAGE = ["dropbox", "box", "google_drive"] as const;

export type SignatureIntent = "send" | "status" | "file" | "preview";

export function signatureIntent(text: string): SignatureIntent | "" {
  const tidy = String(text || "").replace(/\s+/g, " ").trim();
  if (/\b(?:do not|don't|never)\s+(?:send|file|save)\b/i.test(tidy)) return "";
  if (/\b(?:has|have|did)\b[\s\S]{0,60}\bsigned\b/i.test(tidy) || /\bsigned yet\b/i.test(tidy)) return "status";
  if (/\bsave\b[\s\S]{0,80}\bsigned\b/i.test(tidy)) return "file";
  if (/\bsignature preview\b/i.test(tidy) || /\b(?:prepare|review)\b[\s\S]{0,80}\bsignature\b/i.test(tidy)) return "preview";
  if (/\bfor signature\b/i.test(tidy) || /\bsend\b[\s\S]{0,80}\b(?:to sign|for signing)\b/i.test(tidy)) return "send";
  return "";
}

export function isSignatureAsk(text: string) {
  return signatureIntent(text) !== "";
}

export function missingSignatureProviderMessage() {
  return "Dropbox Sign is not connected for this advisor. Save the Dropbox Sign app in Superadmin, then sign in from Settings. I did not send a signature request. OneDrive is not a filing destination.";
}

export type Signer = { name: string; email: string; order: number };
export type SignatureField = { signer: string; kind: "signature" | "date" | "initial"; placement: "placed" | "unclear" };

export type SignatureDraft = {
  advisorId: string;
  documentId: string;
  version: string;
  signers: Signer[];
  fields: SignatureField[];
  message: string;
  storage: string;
  folder: string;
};

export type SignatureStatus = "sent" | "viewed" | "partially_signed" | "completed" | "declined" | "expired" | "failed";

export type SignatureRecord = {
  advisorId: string;
  requestId: string;
  fingerprint: string;
  documentId: string;
  version: string;
  signers: Signer[];
  signedBy: string[];
  status: SignatureStatus;
  folder: string;
  storage: string;
  filed: string[];
  history: string[];
};

export function approvalFingerprint(draft: SignatureDraft) {
  const people = [...draft.signers].sort((left, right) => left.order - right.order).map((signer) => `${signer.order}:${signer.email}`);
  const fields = draft.fields.map((field) => `${field.signer}:${field.kind}:${field.placement}`);
  return [draft.advisorId, draft.documentId, draft.version, people.join("|"), fields.join("|"), draft.storage, draft.folder, draft.message].join("\n");
}

export function prepareSignature(draft: SignatureDraft): { ok: true; fingerprint: string; preview: string } | { ok: false; error: string } {
  if (!draft.documentId || !draft.version) return { ok: false, error: "Which document version should be signed? I did not send a request." };
  if (!draft.signers.length) return { ok: false, error: "Who should sign? I did not send a request." };
  if (draft.signers.some((signer) => !signer.email.includes("@"))) return { ok: false, error: "A signer is missing a verified email address. I did not send a request." };
  const orders = draft.signers.map((signer) => signer.order);
  if (draft.signers.length > 1 && new Set(orders).size !== orders.length) return { ok: false, error: "The signing order is unclear. I did not guess it or send a request." };
  if (draft.fields.some((field) => field.placement === "unclear") || !draft.fields.length) return { ok: false, error: "The signature, date, or initial placement is unclear. I did not guess the fields or send a request." };
  if (!SUPPORTED_STORAGE.includes(draft.storage as (typeof SUPPORTED_STORAGE)[number])) return { ok: false, error: `${draft.storage || "That storage"} is not a connected filing destination. I did not send a request.` };
  if (!draft.folder.startsWith("/")) return { ok: false, error: "Which client folder should receive the signed copy? I did not send a request." };
  const fingerprint = approvalFingerprint(draft);
  const signers = draft.signers.map((signer) => `${signer.order}. ${signer.name} <${signer.email}>`).join("\n");
  const fields = draft.fields.map((field) => `- ${field.kind} for ${field.signer}`).join("\n");
  return {
    ok: true,
    fingerprint,
    preview: [
      `Document ${draft.documentId} version ${draft.version}`,
      `Signers:\n${signers}`,
      `Fields:\n${fields}`,
      `Message: ${draft.message || "none"}`,
      `After completion, file in ${draft.storage}:${draft.folder}`,
      "This confirmation covers only this signature request and the automatic filing of its completed copy. A change to the document or signers withdraws it. I will not sign for anyone.",
    ].join("\n"),
  };
}

export type SandboxState = {
  connected: boolean;
  expired: boolean;
  requests: SignatureRecord[];
  sentFingerprints: string[];
  notices: string[];
};

export function createSandbox(advisorId: string): SandboxState {
  return { connected: true, expired: false, requests: [], sentFingerprints: [], notices: [] };
}

function recordFor(state: SandboxState, advisorId: string, requestId: string) {
  return state.requests.find((item) => item.advisorId === advisorId && item.requestId === requestId);
}

export function sendSandbox(state: SandboxState, draft: SignatureDraft, approvedFingerprint: string): { ok: true; requestId: string; detail: string } | { ok: false; error: string; requestId?: string } {
  if (!state.connected) return { ok: false, error: "No e-signature provider is connected. I did not send a signature request." };
  if (state.expired) return { ok: false, error: "The e-signature connection has expired. I did not send a signature request." };
  const prepared = prepareSignature(draft);
  if (!prepared.ok) return prepared;
  if (prepared.fingerprint !== approvedFingerprint) return { ok: false, error: "That approval does not match this document and these signers. I did not send a request." };
  const existing = state.requests.find((item) => item.advisorId === draft.advisorId && item.fingerprint === prepared.fingerprint);
  if (existing) return { ok: false, error: "That signature request was already sent. I did not send it again.", requestId: existing.requestId };
  const requestId = `sbx-${draft.documentId}-${state.requests.length + 1}`;
  state.requests.push({
    advisorId: draft.advisorId,
    requestId,
    fingerprint: prepared.fingerprint,
    documentId: draft.documentId,
    version: draft.version,
    signers: draft.signers,
    signedBy: [],
    status: "sent",
    folder: draft.folder,
    storage: draft.storage,
    filed: [],
    history: [`approved ${draft.documentId} ${draft.version}`, `sent ${requestId}`],
  });
  state.sentFingerprints.push(prepared.fingerprint);
  return { ok: true, requestId, detail: `Preview sandbox accepted the request as ${requestId}. This was not sent through DocuSign, Adobe Sign, or Dropbox Sign.` };
}

function statusFrom(record: SignatureRecord): SignatureStatus {
  if (record.status === "declined" || record.status === "expired" || record.status === "failed") return record.status;
  if (record.signedBy.length === 0) return record.status === "viewed" ? "viewed" : "sent";
  if (record.signedBy.length < record.signers.length) return "partially_signed";
  return "completed";
}

export function applySandboxNotice(state: SandboxState, advisorId: string, requestId: string, event: "viewed" | "signed" | "declined" | "expired" | "failed", signerEmail = "") {
  const record = recordFor(state, advisorId, requestId);
  if (!record) return { ok: false as const, error: "That signature request is not on this advisor's desk." };
  if (event === "signed" && !record.signers.some((signer) => signer.email === signerEmail)) return { ok: false as const, error: "That email is not a signer on this request." };
  const before = `${record.status}:${record.signedBy.join(",")}`;
  if (event === "viewed" && record.signedBy.length === 0 && record.status === "sent") record.status = "viewed";
  if (event === "signed" && !record.signedBy.includes(signerEmail)) record.signedBy.push(signerEmail);
  if (event === "declined") record.status = "declined";
  if (event === "expired") record.status = "expired";
  if (event === "failed") record.status = "failed";
  if (record.status !== "declined" && record.status !== "expired" && record.status !== "failed") record.status = statusFrom(record);
  const after = `${record.status}:${record.signedBy.join(",")}`;
  if (before === after) return { ok: true as const, duplicate: true, status: record.status, notify: "" };
  record.history.push(`${record.status} ${requestId}`);
  const notify = record.status === "completed" || record.status === "declined" || record.status === "expired" || record.status === "failed"
    ? `Signature ${requestId} is ${record.status.replace("_", " ")}.`
    : "";
  if (notify) state.notices.push(`${advisorId}:${notify}`);
  return { ok: true as const, duplicate: false, status: record.status, notify };
}

export function signatureStatus(state: SandboxState, advisorId: string, requestId: string) {
  const record = recordFor(state, advisorId, requestId);
  if (!record) return { ok: false as const, error: "That signature request is not on this advisor's desk." };
  return { ok: true as const, status: record.status, requestId, signed: record.signedBy.length, required: record.signers.length };
}

export function fileSignedCopy(state: SandboxState, advisorId: string, requestId: string, existingNames: string[], storageOk: boolean) {
  const record = recordFor(state, advisorId, requestId);
  if (!record) return { ok: false as const, error: "That signature request is not on this advisor's desk.", filed: false, requestId };
  if (record.status !== "completed") return { ok: false as const, error: `The provider status is ${record.status}. I did not file a signed copy.`, filed: false, requestId };
  if (record.filed.length) return { ok: true as const, duplicate: true, files: record.filed, requestId, detail: "The signed copy is already filed. I did not file it again or resend the request." };
  if (!storageOk) return { ok: false as const, error: "Signing is complete, but filing failed. The signature request was not sent again.", filed: false, requestId };
  const base = `${record.documentId}-signed-${requestId}.pdf`;
  const certificate = `${record.documentId}-certificate-${requestId}.pdf`;
  const unique = (name: string) => existingNames.includes(name) ? name.replace(/\.pdf$/, `-copy-${existingNames.length + 1}.pdf`) : name;
  const files = [unique(base), unique(certificate)].map((name) => `${record.folder.replace(/\/$/, "")}/${name}`);
  record.filed = files;
  record.history.push(`filed ${files.join(", ")}`);
  return { ok: true as const, duplicate: false, files, requestId, detail: `Filed ${files.length} new files. The original was left unchanged.` };
}

export function reminderAllowed(policyApproved: boolean) {
  return policyApproved
    ? { ok: true as const, detail: "A reminder is allowed by the advisor's reminder policy." }
    : { ok: false as const, error: "No client reminder was sent. There is no advisor-approved reminder policy." };
}
