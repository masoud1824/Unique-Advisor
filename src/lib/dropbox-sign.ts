import { createHmac, timingSafeEqual } from "node:crypto";
import { externalSideEffectsBlocked, ISOLATED_EXTERNAL_BLOCK } from "./isolated-test-desk.ts";

export const DROPBOX_SIGN_AUTH = "https://app.hellosign.com/oauth/authorize";
export const DROPBOX_SIGN_TOKEN = "https://app.hellosign.com/oauth/token";
export const DROPBOX_SIGN_TOKEN_REFRESH = "https://app.hellosign.com/oauth/token?refresh";
export const DROPBOX_SIGN_SEND = "https://api.hellosign.com/v3/signature_request/send";
export function dropboxSignRefusal(status: number, text: string) {
  let name = "";
  let message = "";
  try {
    const json = JSON.parse(text) as {
      error?: { error_name?: string; error_msg?: string } | string;
      error_description?: string;
    };
    if (json.error && typeof json.error === "object") {
      name = String(json.error.error_name || "");
      message = String(json.error.error_msg || "");
    } else if (typeof json.error === "string") {
      name = json.error;
      message = String(json.error_description || "");
    }
  } catch {
    message = text.replace(/\s+/g, " ").slice(0, 140);
  }
  return `Dropbox Sign refused the token exchange (HTTP ${[status, name].filter(Boolean).join(" ")}). ${message}`.replace(/\s+/g, " ").slice(0, 240);
}

export function dropboxSignTokenRequest(input: {
  grantType: string;
  clientId: string;
  clientSecret: string;
  code?: string;
  state?: string;
  refreshToken?: string;
}) {
  const refreshing = input.grantType === "refresh_token";
  return {
    endpoint: refreshing ? DROPBOX_SIGN_TOKEN_REFRESH : DROPBOX_SIGN_TOKEN,
    body: refreshing
      ? {
          grant_type: "refresh_token" as const,
          refresh_token: input.refreshToken || "",
          client_id: input.clientId,
          client_secret: input.clientSecret,
        }
      : {
          grant_type: "authorization_code" as const,
          code: input.code || "",
          state: input.state || "",
          client_id: input.clientId,
          client_secret: input.clientSecret,
        },
  };
}

export type SignField = {
  signerEmail: string;
  kind: "signature" | "date" | "initial";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SignRequest = {
  advisorId: string;
  documentId: string;
  version: string;
  filename: string;
  subject: string;
  message: string;
  signers: Array<{ name: string; email: string; order: number }>;
  fields: SignField[];
  testMode: boolean;
};

const FIELD_TYPE = { signature: "signature", date: "date_signed", initial: "initials" } as const;

export const CALLBACK_ACK = "Hello API Event Received";

export function parseCallbackBody(contentType: string, rawBody: string, formJson: string | null) {
  const source = contentType.includes("application/json") ? rawBody : formJson || "";
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" ? parsed as { event?: { event_type?: string; event_time?: string; event_hash?: string }; signature_request?: { signature_request_id?: string; is_complete?: boolean; metadata?: { advisor_id?: string } } } : null;
  } catch {
    return null;
  }
}

export function dropboxSignEventHash(apiKey: string, eventTime: string, eventType: string) {
  return createHmac("sha256", apiKey).update(`${eventTime}${eventType}`).digest("hex");
}

export function eventIsAuthentic(apiKey: string, eventTime: string, eventType: string, eventHash: string) {
  const expected = dropboxSignEventHash(apiKey, eventTime, eventType);
  const left = Buffer.from(expected);
  const right = Buffer.from(String(eventHash || ""));
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function sendPayload(request: SignRequest, clientId: string) {
  if (!clientId) return { ok: false as const, error: "The Dropbox Sign app is not saved. I did not send a signature request." };
  if (!request.signers.length) return { ok: false as const, error: "Who should sign? I did not send a signature request." };
  if (request.signers.some((signer) => !signer.email.includes("@"))) return { ok: false as const, error: "A signer email is missing. I did not send a signature request." };
  if (!request.testMode && request.signers.some((signer) => !signer.email.endsWith("@test.invalid"))) {
    return { ok: false as const, error: "A live signature request needs an explicit test-mode choice. I did not send it." };
  }
  const orders = request.signers.map((signer) => signer.order);
  if (new Set(orders).size !== orders.length) return { ok: false as const, error: "The signing order is unclear. I did not send a signature request." };
  if (!request.fields.length || request.fields.some((field) => !Number.isFinite(field.x) || !Number.isFinite(field.y) || field.page < 1)) {
    return { ok: false as const, error: "Signature field placement is incomplete. I did not guess the fields or send a request." };
  }
  const form = new FormData();
  form.set("client_id", clientId);
  form.set("test_mode", request.testMode ? "1" : "0");
  form.set("subject", request.subject.slice(0, 255));
  form.set("message", request.message.slice(0, 5000));
  form.set("metadata[advisor_id]", request.advisorId);
  form.set("metadata[document_id]", request.documentId);
  form.set("metadata[version]", request.version);
  request.signers.forEach((signer, index) => {
    form.set(`signers[${index}][name]`, signer.name);
    form.set(`signers[${index}][email_address]`, signer.email);
    form.set(`signers[${index}][order]`, String(signer.order));
  });
  form.set("form_fields_per_document", JSON.stringify([request.fields.map((field, index) => ({
    api_id: `${field.kind}-${index + 1}`,
    name: `${field.kind}-${index + 1}`,
    type: FIELD_TYPE[field.kind],
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.height,
    page: field.page,
    required: true,
    signer: request.signers.findIndex((signer) => signer.email === field.signerEmail),
  }))]));
  return { ok: true as const, form };
}

export function readSendResult(status: number, body: unknown) {
  const record = body && typeof body === "object" ? body as { signature_request?: { signature_request_id?: string; is_complete?: boolean } } : {};
  const requestId = String(record.signature_request?.signature_request_id || "");
  if (status < 200 || status >= 300 || !requestId) {
    return { ok: false as const, error: "Dropbox Sign did not return a signature request ID. I did not record this as sent." };
  }
  return { ok: true as const, requestId, complete: Boolean(record.signature_request?.is_complete) };
}

export type ProviderEvent = {
  eventTime: string;
  eventType: string;
  eventHash: string;
  requestId: string;
  advisorId: string;
};

const STATUS_BY_EVENT: Record<string, "sent" | "viewed" | "partially_signed" | "completed" | "declined" | "expired" | "failed"> = {
  signature_request_sent: "sent",
  signature_request_viewed: "viewed",
  signature_request_signed: "partially_signed",
  signature_request_all_signed: "completed",
  signature_request_declined: "declined",
  signature_request_expired: "expired",
  signature_request_invalid: "failed",
  signature_request_email_bounce: "failed",
  file_error: "failed",
};

export function statusFromEvent(eventType: string, allSigned: boolean) {
  if (eventType === "signature_request_all_signed" || (eventType === "signature_request_signed" && allSigned)) return "completed" as const;
  return STATUS_BY_EVENT[eventType] || "";
}

export function filesUrl(requestId: string, kind: "pdf" | "zip") {
  return `https://api.hellosign.com/v3/signature_request/files/${encodeURIComponent(requestId)}?file_type=${kind}`;
}

export function filingNames(documentId: string, requestId: string, existing: string[]) {
  const signed = `${documentId}-signed-${requestId}.pdf`;
  const audit = `${documentId}-audit-${requestId}.zip`;
  const unique = (name: string) => existing.includes(name) ? name.replace(/\.pdf$/, `-copy-${existing.length + 1}.pdf`) : name;
  return { signed: unique(signed), audit: unique(audit) };
}

export async function uploadToDropbox(token: string, folder: string, name: string, bytes: Uint8Array, fetchImpl: typeof fetch = fetch) {
  if (externalSideEffectsBlocked()) return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK, filed: false as const };
  if (!token) return { ok: false as const, error: "Dropbox is not connected. The signed file was not saved.", filed: false };
  if (!folder.startsWith("/")) return { ok: false as const, error: "The client folder path is missing. The signed file was not saved.", filed: false };
  const path = `${folder.replace(/\/$/, "")}/${name}`;
  let response: Response;
  try {
    response = await fetchImpl("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "add", autorename: true }),
    },
    body: new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]),
  });
  } catch {
    return { ok: false as const, error: "Dropbox did not answer. The file was not uploaded again.", filed: false as const, unknown: true as const };
  }
  if (!response.ok) {
    const unknown = response.status === 408 || response.status === 429 || response.status >= 500;
    return {
      ok: false as const,
      error: unknown
        ? "Dropbox did not confirm the upload. The file was not uploaded again."
        : "Dropbox did not save the signed file. The signature request was not sent again.",
      filed: false as const,
      unknown,
    };
  }
  return { ok: true as const, path, filed: true };
}
