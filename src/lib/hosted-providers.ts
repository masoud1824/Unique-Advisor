/**
 * Production provider adapters for the hosted scheduler.
 * Network access goes through the injected fetch. Tests pass a mock.
 * A missing advisor connection returns a blocked result and does not call fetch.
 */
import type { BirthdayPerson } from "./birthday-job.ts";
import { uploadToDropbox, filesUrl } from "./dropbox-sign.ts";
import type { DispatchProviders, ProviderResult } from "./hosted-dispatch.ts";
import { budgetOpen } from "./hosted-runtime.ts";
import { graphConversationMessagesUrl, graphSendMailBody } from "./graph-mail.ts";
import { outboundBlocked, OUTBOUND_BLOCKED } from "./outbound-guard.ts";
import { statusFromProvider, statusUrl } from "./signature-status.ts";

const GRAPH_SEND = "https://graph.microsoft.com/v1.0/me/sendMail";

export type SecretResult = { ok: true; token: string } | { ok: false; blocked: string };

export type AdvisorSecrets = {
  microsoftAccess: (advisorId: number) => Promise<SecretResult>;
  dropboxAccess: (advisorId: number) => Promise<SecretResult>;
  dropboxSignAccess: (advisorId: number) => Promise<SecretResult>;
};

export type ProviderCall = { url: string; method: string; advisorId: number; authorization: string };

function blockedDetail(): string {
  const gate = providerExecutionGate();
  return gate.attach ? OUTBOUND_BLOCKED : gate.reason;
}
const MAIL_MISSING = "Microsoft mailbox is not connected for this advisor. Nothing was sent.";
const SIGN_MISSING = "Dropbox Sign is not connected for this advisor. Nothing was sent.";
const DROPBOX_MISSING = "Dropbox is not connected for this advisor. Nothing was uploaded.";

export function providerExecutionGate(env: NodeJS.ProcessEnv = process.env): { attach: true } | { attach: false; reason: string } {
  if (env.UA_OUTBOUND_BLOCK === "1" || env.UA_RELEASE_ENV === "staging" || env.UA_RELEASE_ENV === "development") {
    return { attach: false, reason: OUTBOUND_BLOCKED };
  }
  if (outboundBlocked()) return { attach: false, reason: OUTBOUND_BLOCKED };
  if (env.UA_HOST_ENV !== "production") {
    return { attach: false, reason: "Providers stay disconnected until UA_HOST_ENV=production. An execution flag alone does not send." };
  }
  if (env.UA_JOBS_EXECUTE !== "1") {
    return { attach: false, reason: "UA_JOBS_EXECUTE is not 1. Nothing was sent." };
  }
  if (!budgetOpen("mail") || !budgetOpen("signature")) {
    return { attach: false, reason: "A budget switch is on. Nothing was sent." };
  }
  return { attach: true };
}

export function productionAdvisorSecrets(): AdvisorSecrets {
  return {
    async microsoftAccess(advisorId) {
      if (outboundBlocked()) return { ok: false, blocked: OUTBOUND_BLOCKED };
      try {
        const token = await accessTokenForSafe(advisorId);
        return token ? { ok: true, token } : { ok: false, blocked: MAIL_MISSING };
      } catch (error) {
        return { ok: false, blocked: error instanceof Error ? error.message : MAIL_MISSING };
      }
    },
    async dropboxAccess(advisorId) {
      if (outboundBlocked()) return { ok: false, blocked: OUTBOUND_BLOCKED };
      try {
        const { accessToken } = await import("./advisor-links.ts");
        const token = await accessToken(advisorId, "dropbox");
        return token ? { ok: true, token } : { ok: false, blocked: DROPBOX_MISSING };
      } catch (error) {
        return { ok: false, blocked: error instanceof Error ? error.message : DROPBOX_MISSING };
      }
    },
    async dropboxSignAccess(advisorId) {
      if (outboundBlocked()) return { ok: false, blocked: OUTBOUND_BLOCKED };
      try {
        const { accessToken } = await import("./advisor-links.ts");
        const token = await accessToken(advisorId, "dropbox_sign");
        return token ? { ok: true, token } : { ok: false, blocked: SIGN_MISSING };
      } catch (error) {
        return { ok: false, blocked: error instanceof Error ? error.message : SIGN_MISSING };
      }
    },
  };
}

async function accessTokenForSafe(advisorId: number) {
  const { accessTokenForAdvisor } = await import("./microsoft-mail.ts");
  return accessTokenForAdvisor(advisorId);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

function mailOutcome(status: number): ProviderResult {
  if (status === 200 || status === 202) return "accepted";
  if (status === 408 || status === 429 || status >= 500 || status === 0) return "unknown";
  return "failed";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function buildHostedProviders(input: {
  secrets: AdvisorSecrets;
  fetchImpl?: typeof fetch;
  calls?: ProviderCall[];
}): DispatchProviders {
  const fetchImpl = input.fetchImpl ?? fetch;
  const calls = input.calls;

  async function sendMail(advisorId: number, to: string, subject: string, text: string): Promise<{ status: ProviderResult; providerId: string; detail?: string }> {
    if (outboundBlocked() || providerExecutionGate().attach === false) {
      return { status: "failed", providerId: "", detail: blockedDetail() };
    }
    const secret = await input.secrets.microsoftAccess(advisorId);
    if (!secret.ok) return { status: "failed", providerId: "", detail: secret.blocked };
    if (!to.includes("@")) return { status: "failed", providerId: "", detail: "This contact has no email. Nothing was sent." };
    const html = `<p>${escapeHtml(text)}</p>`;
    let response: Response;
    try {
      calls?.push({ url: GRAPH_SEND, method: "POST", advisorId, authorization: secret.token });
      response = await fetchImpl(GRAPH_SEND, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(graphSendMailBody({ to, subject: subject.slice(0, 180) || "Note", html })),
      });
    } catch {
      return { status: "unknown", providerId: "", detail: "Microsoft did not answer. The message was not sent again." };
    }
    const outcome = mailOutcome(response.status);
    if (outcome === "accepted") return { status: "accepted", providerId: `graph:${advisorId}:${to.toLowerCase()}` };
    if (outcome === "unknown") return { status: "unknown", providerId: "", detail: "Microsoft did not confirm acceptance. The message was not sent again." };
    if (response.status === 401 || response.status === 403) return { status: "failed", providerId: "", detail: MAIL_MISSING };
    return { status: "failed", providerId: "", detail: "Microsoft did not accept the message. Nothing was sent." };
  }

  return {
    birthdayDeliver: async (person: BirthdayPerson, card, context) => {
      const advisorId = Number(context?.advisorId);
      if (!Number.isInteger(advisorId) || advisorId <= 0) {
        return { status: "failed", providerId: "", detail: "Advisor was not identified. Nothing was sent." };
      }
      return sendMail(advisorId, person.email.trim(), "Birthday", card.text);
    },
    dripSend: async (step) => {
      const result = await sendMail(step.advisorId, step.email.trim(), step.subject || "Note", step.body || step.subject || "");
      if (result.status === "accepted") return { ok: true };
      if (result.status === "unknown") return { ok: false, unknown: true, error: result.detail || "Microsoft did not confirm the drip. It was not sent again." };
      return { ok: false, error: result.detail || MAIL_MISSING };
    },
    listReplies: async (thread) => {
      if (outboundBlocked() || !providerExecutionGate().attach) {
        return { blocked: blockedDetail() };
      }
      const secret = await input.secrets.microsoftAccess(thread.advisorId);
      if (!secret.ok) return { blocked: secret.blocked };
      const url = graphConversationMessagesUrl(thread.conversationId);
      let response: Response;
      try {
        calls?.push({ url, method: "GET", advisorId: thread.advisorId, authorization: secret.token });
        response = await fetchImpl(url, { headers: { Authorization: `Bearer ${secret.token}` } });
      } catch {
        return { unknown: true };
      }
      if (response.status === 401 || response.status === 403) return { blocked: MAIL_MISSING };
      if (response.status === 408 || response.status === 429 || response.status >= 500) return { unknown: true };
      if (!response.ok) return { blocked: "The sent thread could not be read. No other mail was opened." };
      const body = await readJson(response) as { value?: Array<{ id?: string; conversationId?: string; from?: { emailAddress?: { address?: string } } }> } | null;
      return (body?.value || []).map((item) => ({
        id: String(item.id || ""),
        conversationId: String(item.conversationId || ""),
        from: String(item.from?.emailAddress?.address || ""),
      }));
    },
    signatureStatus: async (row) => {
      if (outboundBlocked() || !providerExecutionGate().attach) {
        return { outcome: "blocked", providerId: "", detail: blockedDetail() };
      }
      const secret = await input.secrets.dropboxSignAccess(row.advisorId);
      if (!secret.ok) return { outcome: "blocked", providerId: "", detail: secret.blocked };
      const url = statusUrl(row.requestId);
      let response: Response;
      try {
        calls?.push({ url, method: "GET", advisorId: row.advisorId, authorization: secret.token });
        response = await fetchImpl(url, { headers: { Authorization: `Bearer ${secret.token}` } });
      } catch {
        return { outcome: "unknown", providerId: "", detail: "Dropbox Sign ended before a result was stored" };
      }
      if (response.status === 401 || response.status === 403) return { outcome: "blocked", providerId: "", detail: SIGN_MISSING };
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        return { outcome: "unknown", providerId: "", detail: "Dropbox Sign did not confirm this request. It was not sent again." };
      }
      const body = await readJson(response) as { signature_request?: Parameters<typeof statusFromProvider>[0] & { signature_request_id?: string } } | null;
      const record = body?.signature_request;
      if (!response.ok || !record) {
        return { outcome: "blocked", providerId: "", detail: "Dropbox Sign did not return this request. I did not mark it completed." };
      }
      const progress = statusFromProvider(record);
      const providerId = String(record.signature_request_id || row.requestId);
      if (progress === "completed") return { outcome: "completed", providerId };
      if (progress === "declined") return { outcome: "declined", providerId };
      if (progress === "failed" || progress === "expired") return { outcome: "failed", providerId, detail: `signature ${progress}` };
      return { outcome: "waiting", providerId: `${providerId}:${progress}` };
    },
    fileSigned: async (row) => {
      if (outboundBlocked() || !providerExecutionGate().attach) {
        return { outcome: "blocked", detail: blockedDetail() };
      }
      if (!row.folder.startsWith("/")) return { outcome: "blocked", detail: "The client folder path is missing. Nothing was uploaded." };
      const sign = await input.secrets.dropboxSignAccess(row.advisorId);
      if (!sign.ok) return { outcome: "blocked", detail: sign.blocked };
      const dropbox = await input.secrets.dropboxAccess(row.advisorId);
      if (!dropbox.ok) return { outcome: "blocked", detail: dropbox.blocked };
      const downloadUrl = filesUrl(row.requestId, "pdf");
      let downloaded: Response;
      try {
        calls?.push({ url: downloadUrl, method: "GET", advisorId: row.advisorId, authorization: sign.token });
        downloaded = await fetchImpl(downloadUrl, { headers: { Authorization: `Bearer ${sign.token}` } });
      } catch {
        return { outcome: "unknown", detail: "Dropbox Sign ended before the signed file was stored" };
      }
      if (downloaded.status === 401 || downloaded.status === 403) return { outcome: "blocked", detail: SIGN_MISSING };
      if (downloaded.status === 408 || downloaded.status === 429 || downloaded.status >= 500) {
        return { outcome: "unknown", detail: "Dropbox Sign did not confirm the signed file. It was not uploaded again." };
      }
      if (!downloaded.ok) return { outcome: "failed", detail: "The signed PDF was not available. Nothing was uploaded." };
      const bytes = new Uint8Array(await downloaded.arrayBuffer());
      if (bytes.byteLength < 5) return { outcome: "failed", detail: "The signed PDF was empty. Nothing was uploaded." };
      const uploadUrl = "https://content.dropboxapi.com/2/files/upload";
      calls?.push({ url: uploadUrl, method: "POST", advisorId: row.advisorId, authorization: dropbox.token });
      const saved = await uploadToDropbox(dropbox.token, row.folder, `${row.requestId}-signed.pdf`, bytes, fetchImpl);
      if (saved.ok && saved.path.startsWith("/")) return { outcome: "accepted", path: saved.path };
      if ("unknown" in saved && saved.unknown) return { outcome: "unknown", detail: saved.error };
      return { outcome: "blocked", detail: saved.error || DROPBOX_MISSING };
    },
  };
}
