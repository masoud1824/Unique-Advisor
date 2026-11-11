import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";

const MAIL_SCOPES = "offline_access Mail.Send User.Read Calendars.ReadWrite";
const CALENDAR_SCOPES = "offline_access User.Read Calendars.ReadWrite";
const SEND_SCOPES = "offline_access Mail.Send User.Read";
const SCOPES = `${MAIL_SCOPES} Mail.Read`;
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

export type MicrosoftConfig = { clientId: string; clientSecret: string };

export function microsoftConfig(): MicrosoftConfig | null {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function loadMicrosoftConfig(): Promise<MicrosoftConfig | null> {
  const fromEnv = microsoftConfig();
  if (fromEnv) return fromEnv;
  const sql = await getSql();
  const rows = await sql<{ client_id: string; client_secret: string }>`
    select client_id, client_secret from microsoft_app where id = 1
  `;
  const row = rows[0];
  if (!row?.client_id || !row.client_secret) return null;
  try {
    const clientSecret = await openSecret(row.client_secret);
    if (!clientSecret) return null;
    return { clientId: row.client_id, clientSecret };
  } catch {
    return null;
  }
}

export async function microsoftAppStatus() {
  if (microsoftConfig()) {
    return { configured: true, source: "environment" as const, clientId: microsoftConfig()?.clientId ?? "" };
  }
  const sql = await getSql();
  const rows = await sql<{ client_id: string; client_secret: string }>`
    select client_id, client_secret from microsoft_app where id = 1
  `;
  const row = rows[0];
  if (row?.client_id && row.client_secret) {
    return { configured: true, source: "saved" as const, clientId: row.client_id };
  }
  return { configured: false, source: "none" as const, clientId: "" };
}

export async function saveMicrosoftAppCredentials(clientId: string, clientSecret: string) {
  const sealed = await sealSecret(clientSecret);
  const sql = await getSql();
  await sql`
    insert into microsoft_app (id, client_id, client_secret, seal_key)
    values (1, ${clientId}, ${sealed}, '')
    on conflict (id) do update
    set client_id = excluded.client_id,
        client_secret = excluded.client_secret
  `;
}

export function missingMicrosoftEnv() {
  const missing: string[] = [];
  if (!process.env.MICROSOFT_CLIENT_ID?.trim()) missing.push("MICROSOFT_CLIENT_ID");
  if (!process.env.MICROSOFT_CLIENT_SECRET?.trim()) missing.push("MICROSOFT_CLIENT_SECRET");
  return missing;
}

export function explainMicrosoftError(status: number, body: string) {
  const text = body.replace(/\s+/g, " ").slice(0, 500);
  const lower = text.toLowerCase();
  if (lower.includes("aadsts7000215") || lower.includes("invalid_client")) {
    return "Microsoft rejected the app secret. In Entra, Certificates & secrets, create a client secret and paste the Value, not the Secret ID.";
  }
  if (lower.includes("aadsts50011")) {
    return "Microsoft rejected the redirect URI. In Entra, Authentication, add a Web redirect URI that matches this site exactly, including https and the path /api/microsoft/callback.";
  }
  if (lower.includes("aadsts700016")) {
    return "The Application (client) ID does not match an app in Microsoft Entra.";
  }
  if (lower.includes("aadsts65001") || lower.includes("aadsts650052") || lower.includes("consent_required")) {
    return "This mailbox has not granted Mail.Send. Connect again and accept the permission. A work or school account may need an admin to grant delegated Mail.Send.";
  }
  if (lower.includes("aadsts50020") || lower.includes("does not exist in tenant")) {
    return "This Microsoft account cannot use the app. The Entra app must allow both work or school accounts and personal Microsoft accounts.";
  }
  if (lower.includes("invalid_grant") || lower.includes("aadsts700082") || lower.includes("aadsts50173")) {
    return "Microsoft sign-in expired or was revoked. Connect Microsoft Email again.";
  }
  if (status === 403 || lower.includes("erroraccessdenied") || lower.includes("accessdenied")) {
    return "Microsoft refused to send. The app needs the delegated Mail.Send permission, and the signed-in person must accept it.";
  }
  if (status === 401) return "Microsoft did not accept the mailbox token. Connect Microsoft Email again.";
  if (lower.includes("aadsts")) return text.slice(0, 280);
  if (status) return `Microsoft returned ${status}. ${text.slice(0, 220)}`;
  return text.slice(0, 280) || "Microsoft did not complete the request.";
}

async function tokenKey() {
  const secret = process.env.MICROSOFT_TOKEN_KEY?.trim() || "";
  if (secret.length >= 8) return createHash("sha256").update(`unique-advisor-microsoft:${secret}`).digest();
  const sql = await getSql();
  const rows = await sql<{ seal_key: string }>`select seal_key from microsoft_app where id = 1`;
  let key = rows[0]?.seal_key ?? "";
  if (key.length < 16) {
    key = randomBytes(32).toString("base64");
    await sql`
      insert into microsoft_app (id, client_id, client_secret, seal_key)
      values (1, '', '', ${key})
      on conflict (id) do update set seal_key = excluded.seal_key
      where microsoft_app.seal_key = ''
    `;
    const again = await sql<{ seal_key: string }>`select seal_key from microsoft_app where id = 1`;
    key = again[0]?.seal_key || key;
  }
  return createHash("sha256").update(`unique-advisor-microsoft:${key}`).digest();
}

export async function signingKey() {
  return tokenKey();
}

export async function sealSecret(plain: string) {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export async function openSecret(stored: string) {
  if (!stored) return "";
  const buf = Buffer.from(stored, "base64");
  if (buf.length < 29) throw new Error("Stored Microsoft token is unreadable. Connect Microsoft Email again.");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", await tokenKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

function base64url(bytes: Buffer) {
  return bytes.toString("base64url");
}

export function createPkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function authorizeUrl(input: { clientId: string; redirectUri: string; state: string; challenge: string }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export function assertCallbackUrl(candidate: string, request: Request) {
  const forced = process.env.MICROSOFT_REDIRECT_URI?.trim();
  if (forced) return forced;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("The Microsoft return address is not a valid URL.");
  }
  const allowed = new Set<string>();
  const rawHosts = [
    request.headers.get("origin") || "",
    request.headers.get("referer") || "",
    request.headers.get("x-forwarded-host") || "",
    request.headers.get("host") || "",
  ];
  for (const value of rawHosts) {
    for (const part of value.split(",")) {
      const item = part.trim();
      if (!item) continue;
      try {
        allowed.add((item.includes("://") ? new URL(item).host : item).toLowerCase());
      } catch {
        /* ignore a header that is not a URL */
      }
    }
  }
  if (!allowed.has(url.host.toLowerCase())) {
    throw new Error("The Microsoft return address does not match this site.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Microsoft sign-in must return over https.");
  }
  if (!/^(?:\/hds-[a-z0-9]+-\d+-[a-z0-9]+)?\/api\/microsoft\/callback$/i.test(url.pathname)) {
    throw new Error("The Microsoft return address must be /api/microsoft/callback.");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(explainMicrosoftError(response.status, text));
  const json = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("Microsoft did not return an access token.");
  return json;
}

export async function exchangeCode(input: { code: string; verifier: string; redirectUri: string }) {
  const config = await loadMicrosoftConfig();
  if (!config) throw new Error("Microsoft sign-in is not configured. Add the Entra application ID and secret first.");
  return tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
      scope: SCOPES,
    }),
  );
}

export async function refreshAccess(refreshToken: string) {
  const config = await loadMicrosoftConfig();
  if (!config) throw new Error("Microsoft sign-in is not configured. Add the Entra application ID and secret first.");
  const base = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  try {
    return await tokenRequest(new URLSearchParams(base));
  } catch {
    /* A newer permission was not on the original sign-in. Keep the grant they already accepted. */
  }
  let last: unknown;
  for (const scope of [MAIL_SCOPES, CALENDAR_SCOPES, SEND_SCOPES, SCOPES]) {
    try {
      const body = new URLSearchParams(base);
      body.set("scope", scope);
      return await tokenRequest(body);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("Microsoft did not refresh the sign-in.");
}

export async function graphInbox(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=8&$select=subject,from,bodyPreview,receivedDateTime&$orderby=receivedDateTime desc", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    return { ok: false as const, error: "I can send from this mailbox, but reading it needs a fresh connection. Open Settings, connect Microsoft email again, and accept reading mail." };
  }
  if (!response.ok) return { ok: false as const, error: "The inbox could not be read." };
  const body = (await response.json()) as { value?: Array<{ subject?: string; bodyPreview?: string; from?: { emailAddress?: { name?: string; address?: string } } }> };
  const messages = (body.value || []).map((item) => ({
    from: item.from?.emailAddress?.name || item.from?.emailAddress?.address || "Someone",
    subject: String(item.subject || "(no subject)").replace(/\s+/g, " ").trim().slice(0, 120),
    preview: String(item.bodyPreview || "").replace(/\s+/g, " ").trim().slice(0, 140),
  }));
  return { ok: true as const, messages };
}

export async function graphMe(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(explainMicrosoftError(response.status, text));
  const json = JSON.parse(text) as { displayName?: string; mail?: string | null; userPrincipalName?: string };
  const email = (json.mail || json.userPrincipalName || "").trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Microsoft did not return a mailbox address for this account.");
  return { email, name: (json.displayName || "").trim().slice(0, 80) };
}

export async function graphSendMail(input: {
  accessToken: string;
  to: string;
  subject: string;
  html: string;
  image?: Buffer | null;
  inline?: { name: string; contentType: string; contentId: string; bytes: Buffer }[];
  files?: { name: string; contentType: string; bytes: Buffer }[];
}) {
  const attachments = [
    ...(input.image
      ? [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: "e-card.jpg",
            contentType: "image/jpeg",
            contentBytes: input.image.toString("base64"),
            isInline: true,
            contentId: "card",
          },
        ]
      : []),
    ...(input.inline ?? []).map((item) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: item.name,
      contentType: item.contentType,
      contentBytes: item.bytes.toString("base64"),
      isInline: true,
      contentId: item.contentId,
    })),
    ...(input.files ?? []).map((item) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: item.name,
      contentType: item.contentType,
      contentBytes: item.bytes.toString("base64"),
      isInline: false,
    })),
  ];
  const message: {
    subject: string;
    body: { contentType: "HTML"; content: string };
    toRecipients: { emailAddress: { address: string } }[];
    attachments?: typeof attachments;
  } = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.html },
    toRecipients: [{ emailAddress: { address: input.to } }],
  };
  if (attachments.length > 0) message.attachments = attachments;
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      saveToSentItems: true,
    }),
  });
  if (response.status === 202 || response.status === 200) return;
  const text = await response.text();
  throw new Error(explainMicrosoftError(response.status, text));
}

export async function saveMicrosoftConnection(input: {
  advisorId: number;
  email: string;
  name: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) {
  if (!input.refreshToken) {
    throw new Error("Microsoft did not return a refresh token. Connect again and accept offline access.");
  }
  const refresh = await sealSecret(input.refreshToken);
  const access = await sealSecret(input.accessToken);
  const sql = await getSql();
  await sql`
    update advisors
    set mail_provider = 'microsoft',
        mail_from = ${input.email},
        mail_name = ${input.name},
        mail_host = '',
        mail_user = ${input.email},
        mail_pass = '',
        ms_refresh = ${refresh},
        ms_access = ${access},
        ms_expires = ${Date.now() + (Number(input.expiresIn) || 3600) * 1000}
    where id = ${input.advisorId}
  `;
}

export async function takeOAuthState(state: string) {
  const sql = await getSql();
  await sql`delete from oauth_states where created_at < now() - interval '20 minutes'`;
  const rows = await sql<{
    advisor_id: number;
    slug: string;
    verifier: string;
    redirect_uri: string;
    display_name: string;
  }>`
    delete from oauth_states where state = ${state}
    returning advisor_id, slug, verifier, redirect_uri, display_name
  `;
  return rows[0] ?? null;
}

export async function accessTokenForAdvisor(advisorId: number) {
  const sql = await getSql();
  const rows = await sql<{ ms_refresh: string; ms_access: string; ms_expires: number | string }>`
    select ms_refresh, ms_access, ms_expires from advisors where id = ${advisorId}
  `;
  const row = rows[0];
  if (!row?.ms_refresh) throw new Error("Connect Microsoft Email in Settings before sending.");
  const refresh = await openSecret(row.ms_refresh);
  const expires = Number(row.ms_expires) || 0;
  if (row.ms_access && expires > Date.now() + 60_000) return openSecret(row.ms_access);
  const next = await refreshAccess(refresh);
  const access = next.access_token as string;
  const storedRefresh = next.refresh_token ? await sealSecret(next.refresh_token) : row.ms_refresh;
  const msExpires = Date.now() + (Number(next.expires_in) || 3600) * 1000;
  await sql`
    update advisors
    set ms_access = ${await sealSecret(access)}, ms_refresh = ${storedRefresh}, ms_expires = ${msExpires}
    where id = ${advisorId}
  `;
  return access;
}
