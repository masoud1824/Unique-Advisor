import type { SignatureProgress } from "./signature-status.ts";

export const DOCUSIGN_AUTH = "https://account-d.docusign.com/oauth/auth";
export const DOCUSIGN_TOKEN = "https://account-d.docusign.com/oauth/token";
export const DOCUSIGN_USERINFO = "https://account-d.docusign.com/oauth/userinfo";
export const BOX_ACCOUNT = "https://api.box.com/2.0/users/me";
export const DRIVE_ACCOUNT = "https://www.googleapis.com/oauth2/v2/userinfo";
export const ONEDRIVE_AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const ONEDRIVE_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const ONEDRIVE_ACCOUNT = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
export const ADOBE_AUTH = "https://secure.na1.adobesign.com/public/oauth/v2";
export const ADOBE_TOKEN = "https://api.na1.adobesign.com/oauth/v2/token";
export const ADOBE_ACCOUNT = "https://api.na1.adobesign.com/api/rest/v6/users/me";

export function docusignEnvelopeRequest(input: { accountId: string; baseUrl: string; subject: string; email: string; name: string; pdfBase64: string }) {
  return {
    method: "POST" as const,
    url: `${input.baseUrl}/restapi/v2.1/accounts/${encodeURIComponent(input.accountId)}/envelopes`,
    body: {
      emailSubject: input.subject,
      status: "sent",
      documents: [{ documentBase64: input.pdfBase64, name: "TEST ONLY.pdf", fileExtension: "pdf", documentId: "1" }],
      recipients: {
        signers: [{
          email: input.email,
          name: input.name,
          recipientId: "1",
          tabs: { signHereTabs: [{ documentId: "1", pageNumber: "1", xPosition: "72", yPosition: "152" }] },
        }],
      },
    },
  };
}

export function docusignStatusUrl(baseUrl: string, accountId: string, envelopeId: string) {
  return `${baseUrl}/restapi/v2.1/accounts/${encodeURIComponent(accountId)}/envelopes/${encodeURIComponent(envelopeId)}`;
}

export function docusignDocumentUrl(baseUrl: string, accountId: string, envelopeId: string, kind: "combined" | "certificate") {
  return `${docusignStatusUrl(baseUrl, accountId, envelopeId)}/documents/${kind}`;
}

export function mapDocuSignStatus(status: string): SignatureProgress {
  const value = status.toLowerCase();
  if (value === "completed" || value === "signed") return "completed";
  if (value === "declined") return "declined";
  if (value === "voided" || value === "timedout") return "expired";
  if (value === "delivered") return "viewed";
  return "sent";
}

export function boxFolderUrl(folderId: string) {
  return `https://api.box.com/2.0/folders/${encodeURIComponent(folderId)}?fields=id,type,name`;
}

export function boxFileUrl(fileId: string) {
  return `https://api.box.com/2.0/files/${encodeURIComponent(fileId)}/content`;
}

export function driveFileUrl(fileId: string) {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
}

export function oneDriveUploadUrl(folderId: string, name: string) {
  return `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`;
}

export function adobeAgreementRequest(input: { transientDocumentId: string; subject: string; email: string }) {
  return {
    method: "POST" as const,
    url: "https://api.na1.adobesign.com/api/rest/v6/agreements",
    body: {
      fileInfos: [{ transientDocumentId: input.transientDocumentId }],
      name: input.subject,
      signatureType: "ESIGN",
      state: "IN_PROCESS",
      participantSetsInfo: [{ memberInfos: [{ email: input.email }], order: 1, role: "SIGNER" }],
    },
  };
}

export function adobeStatusUrl(agreementId: string) {
  return `https://api.na1.adobesign.com/api/rest/v6/agreements/${encodeURIComponent(agreementId)}`;
}

export function adobeDocumentUrl(agreementId: string, kind: "combined" | "audit") {
  const suffix = kind === "audit" ? "auditTrail" : "combinedDocument";
  return `${adobeStatusUrl(agreementId)}/${suffix}`;
}

export function mapAdobeStatus(status: string): SignatureProgress {
  const value = status.toUpperCase();
  if (value === "SIGNED" || value === "APPROVED" || value === "COMPLETED") return "completed";
  if (value === "CANCELLED" || value === "ABORTED") return "declined";
  if (value === "EXPIRED") return "expired";
  return "sent";
}

export async function readSignatureStatus(input: { provider: string; requestId: string; token: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = input.fetchImpl || fetch;
  const headers = { Authorization: `Bearer ${input.token}` };
  if (input.provider === "docusign") {
    const info = await fetchImpl(DOCUSIGN_USERINFO, { headers });
    if (!info.ok) return { ok: false as const, error: "DocuSign did not confirm this advisor's account. I did not use Dropbox Sign." };
    const user = await info.json() as { accounts?: Array<{ account_id?: string; is_default?: boolean; base_uri?: string }> };
    const account = user.accounts?.find((item) => item.is_default) || user.accounts?.[0];
    if (!account?.account_id || !account.base_uri) return { ok: false as const, error: "DocuSign did not return an account. I did not use Dropbox Sign." };
    const response = await fetchImpl(docusignStatusUrl(account.base_uri, account.account_id, input.requestId), { headers });
    if (!response.ok) return { ok: false as const, error: "DocuSign did not return this envelope. I did not mark it completed." };
    const body = await response.json() as { status?: string };
    return { ok: true as const, status: mapDocuSignStatus(String(body.status || "")), documents: {
      signed: docusignDocumentUrl(account.base_uri, account.account_id, input.requestId, "combined"),
      audit: docusignDocumentUrl(account.base_uri, account.account_id, input.requestId, "certificate"),
    } };
  }
  if (input.provider === "adobe_sign") {
    const response = await fetchImpl(adobeStatusUrl(input.requestId), { headers });
    if (!response.ok) return { ok: false as const, error: "Adobe Acrobat Sign did not return this agreement. I did not mark it completed." };
    const body = await response.json() as { status?: string };
    return { ok: true as const, status: mapAdobeStatus(String(body.status || "")), documents: {
      signed: adobeDocumentUrl(input.requestId, "combined"),
      audit: adobeDocumentUrl(input.requestId, "audit"),
    } };
  }
  return { ok: false as const, error: "That signature provider is not connected. I did not use another signature provider." };
}
