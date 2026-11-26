import { createHash, randomBytes } from "node:crypto";
import { dbSource, getSql } from "@/lib/db";
import { PREVIEW_WRITE_BLOCK, previewWritesBlocked } from "@/lib/preview-readonly";
import { externalSideEffectsBlocked, connectionSetupBlocked, ISOLATED_EXTERNAL_BLOCK } from "@/lib/isolated-test-desk";
import { loadMicrosoftConfig, openSecret, sealSecret, accessTokenForAdvisor } from "@/lib/microsoft-mail";
import { safeZone } from "@/lib/meeting-time";
import { noteLookup } from "@/lib/lookup-log";
import { dropboxSignRefusal, dropboxSignTokenRequest } from "@/lib/dropbox-sign";
const LINK_PROVIDERS = ["google", "zoom", "dropbox", "outlook_calendar", "box", "google_drive", "onedrive", "dropbox_sign", "docusign", "adobe_sign"];
const SETUP = {
  google: {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/calendar.events",
    label: "Google Calendar"
  },
  zoom: {
    auth: "https://zoom.us/oauth/authorize",
    token: "https://zoom.us/oauth/token",
    scope: "user:read:user meeting:write:meeting meeting:read:meeting meeting:read:list_meetings meeting:update:meeting meeting:delete:meeting cloud_recording:read:list_user_recordings cloud_recording:read:recording",
    label: "Zoom"
  },
  dropbox: {
    auth: "https://www.dropbox.com/oauth2/authorize",
    token: "https://api.dropboxapi.com/oauth2/token",
    scope: "account_info.read files.metadata.read files.content.read files.content.write",
    label: "Dropbox"
  },
  outlook_calendar: {
    auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access User.Read Calendars.Read",
    label: "Outlook Calendar"
  },
  box: {
    auth: "https://account.box.com/api/oauth2/authorize",
    token: "https://api.box.com/oauth2/token",
    scope: "root_readwrite",
    label: "Box"
  },
  google_drive: {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/drive.file",
    label: "Google Drive"
  },
  onedrive: {
    auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access User.Read Files.ReadWrite",
    label: "OneDrive"
  },
  dropbox_sign: {
    auth: "https://app.hellosign.com/oauth/authorize",
    token: "https://app.hellosign.com/oauth/token",
    scope: "signature_request_access account_access",
    label: "Dropbox Sign"
  },
  docusign: {
    auth: "https://account-d.docusign.com/oauth/auth",
    token: "https://account-d.docusign.com/oauth/token",
    scope: "signature",
    label: "DocuSign demo"
  },
  adobe_sign: {
    auth: "https://secure.na1.adobesign.com/public/oauth/v2",
    token: "https://api.na1.adobesign.com/oauth/v2/token",
    scope: "user_login:self agreement_read:self agreement_write:self agreement_send:self",
    label: "Adobe Acrobat Sign"
  }
};
function setupFor(provider: string) {
  if (!Object.prototype.hasOwnProperty.call(SETUP, provider)) return undefined;
  return SETUP[provider as keyof typeof SETUP];
}
function linkLabel(provider: string) {
  return setupFor(provider)?.label ?? provider;
}
function isLinkProvider(value: string) {
  return LINK_PROVIDERS.includes(value);
}
async function ensureLinkTables() {
  const sql = await getSql();
  await sql.query(`create table if not exists link_apps (
    provider text primary key,
    client_id text not null default '',
    client_secret text not null default ''
  )`);
  await sql.query("alter table link_apps add column if not exists api_key text not null default ''");
  await sql.query(`create table if not exists advisor_links (
    advisor_id integer not null references advisors(id) on delete cascade,
    provider text not null,
    account_label text not null default '',
    refresh_token text not null default '',
    access_token text not null default '',
    expires_at bigint not null default 0,
    primary key (advisor_id, provider)
  )`);
  await sql.query(`create table if not exists assistant_actions (
    id serial primary key,
    advisor_id integer not null references advisors(id) on delete cascade,
    kind text not null,
    summary text not null,
    payload text not null,
    status text not null default 'pending',
    created_at timestamptz not null default now()
  )`);
  await sql.query("alter table assistant_actions add column if not exists chat_id integer");
  await sql.query("alter table assistant_actions add column if not exists message_id integer");
  await sql.query("alter table oauth_states add column if not exists provider text not null default 'microsoft'");
  await sql.query("alter table advisor_links add column if not exists login_user text not null default ''");
  await sql.query("alter table advisor_links add column if not exists login_pass text not null default ''");
  await sql.query(`create table if not exists test_calendar_events (
    id serial primary key,
    advisor_id integer not null references advisors(id) on delete cascade,
    title text not null,
    start_at timestamptz not null,
    minutes integer not null default 30
  )`);
}
async function linkAppStatus() {
  await ensureLinkTables();
  const microsoft = await loadMicrosoftConfig();
  const rows = await (await getSql())<{ provider: string; client_id: string; client_secret: string; api_key: string }>`select provider, client_id, client_secret, api_key from link_apps`;
  const saved = /* @__PURE__ */ new Map();
  for (const row of rows) {
    let secretMask = "";
    let apiKeyMask = "";
    if (row.client_secret) {
      try {
        const secret = await openSecret(row.client_secret);
        secretMask = secret ? `\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${secret.slice(-4)}` : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      } catch {
        secretMask = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      }
    }
    if (row.api_key) {
      try {
        const apiKey = await openSecret(row.api_key);
        apiKeyMask = apiKey ? `\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${apiKey.slice(-4)}` : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      } catch {
        apiKeyMask = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      }
    }
    saved.set(row.provider, { clientId: row.client_id || "", secretMask, apiKeyMask, hasApiKey: Boolean(row.api_key) });
  }
  return LINK_PROVIDERS.map((provider) => ({
    provider,
    label: setupFor(provider)?.label ?? provider,
    configured: provider === "outlook_calendar"
      ? Boolean(microsoft)
      : provider === "dropbox_sign"
        ? Boolean(saved.get(provider)?.clientId && saved.get(provider)?.secretMask && saved.get(provider)?.hasApiKey)
        : Boolean(saved.get(provider)?.clientId),
    clientId: provider === "outlook_calendar" ? microsoft?.clientId ?? "" : saved.get(provider)?.clientId ?? "",
    secretMask: provider === "outlook_calendar" ? "" : saved.get(provider)?.secretMask ?? "",
    apiKeyMask: saved.get(provider)?.apiKeyMask ?? "",
    hasApiKey: Boolean(saved.get(provider)?.hasApiKey)
  }));
}
async function saveLinkApp(provider: string, clientId: string, clientSecret: string, apiKey = "") {
  if (provider === "outlook_calendar") return;
  await ensureLinkTables();
  const sealed = await sealSecret(clientSecret);
  const sealedKey = apiKey ? await sealSecret(apiKey) : "";
  await (await getSql())`
    insert into link_apps (provider, client_id, client_secret, api_key)
    values (${provider}, ${clientId}, ${sealed}, ${sealedKey})
    on conflict (provider) do update set
      client_id = excluded.client_id,
      client_secret = excluded.client_secret,
      api_key = case when excluded.api_key = '' then link_apps.api_key else excluded.api_key end
  `;
}
async function appConfig(provider: string) {
  if (provider === "outlook_calendar") return loadMicrosoftConfig();
  await ensureLinkTables();
  const rows = await (await getSql())<{ client_id: string; client_secret: string }>`
    select client_id, client_secret from link_apps where provider = ${provider}
  `;
  const row = rows[0];
  if (!row?.client_id || !row.client_secret) return null;
  const clientSecret = await openSecret(row.client_secret);
  if (!clientSecret) return null;
  return { clientId: row.client_id, clientSecret };
}
function assertLinkCallback(candidate: string, request: Request) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("The return address is not a valid URL.");
  }
  const allowed = /* @__PURE__ */ new Set();
  for (const value of [request.headers.get("origin") || "", request.headers.get("referer") || "", request.headers.get("x-forwarded-host") || "", request.headers.get("host") || ""]) {
    for (const part of value.split(",")) {
      const item = part.trim();
      if (!item) continue;
      try {
        allowed.add((item.includes("://") ? new URL(item).host : item).toLowerCase());
      } catch {
      }
    }
  }
  if (!allowed.has(url.host.toLowerCase())) throw new Error("The return address does not match this site.");
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("The connection must return over https.");
  }
  if (!/^(?:\/hds-[a-z0-9]+-\d+-[a-z0-9]+)?\/api\/link\/callback$/i.test(url.pathname)) {
    throw new Error("The return address must be /api/link/callback.");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}
function linkAuthorizeUrl(input: { provider: string; clientId: string; redirectUri: string; state: string; challenge?: string }) {
  const spec = setupFor(input.provider);
  if (!spec) throw new Error("That connection is not available.");
  const url = new URL(spec.auth);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  if (input.provider !== "dropbox_sign") url.searchParams.set("scope", spec.scope);
  if (input.provider !== "dropbox_sign" && input.provider !== "adobe_sign") {
    url.searchParams.set("code_challenge", input.challenge || "");
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (input.provider === "google" || input.provider === "google_drive") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  if (input.provider === "dropbox") {
    url.searchParams.set("token_access_type", "offline");
    url.searchParams.set("include_granted_scopes", "user");
  }
  if (input.provider === "outlook_calendar" || input.provider === "onedrive") {
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("prompt", "select_account");
  }
  return url.toString();
}
function createLinkPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
async function takeLinkState(state: string) {
  await ensureLinkTables();
  const sql = await getSql();
  await sql`delete from oauth_states where created_at < now() - interval '20 minutes'`;
  const rows = await sql<{ advisor_id: number; slug: string; verifier: string; redirect_uri: string; provider: string }>`
    delete from oauth_states where state = ${state}
    returning advisor_id, slug, verifier, redirect_uri, provider
  `;
  return rows[0] ?? null;
}
async function tokenPost(provider: string, body: URLSearchParams) {
  if (connectionSetupBlocked()) throw new Error(ISOLATED_EXTERNAL_BLOCK);
  const config = await appConfig(provider);
  if (!config) throw new Error(`${linkLabel(provider)} is not set up yet. Add it in Superadmin first.`);
  if (provider === "dropbox_sign") {
    const grant = String(body.get("grant_type") || "authorization_code");
    const code = String(body.get("code") || "");
    const state = String(body.get("state") || "");
    const refreshToken = String(body.get("refresh_token") || "");
    const built = dropboxSignTokenRequest({
      grantType: grant,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      state,
      refreshToken,
    });
    if (grant === "refresh_token" && !refreshToken) throw new Error("Dropbox Sign did not return a refresh token. Press Sign in with Dropbox Sign again.");
    if (grant !== "refresh_token" && (!code || !state)) {
      throw new Error("Dropbox Sign did not return the sign-in code and state. Press Sign in with Dropbox Sign again.");
    }
    const response = await fetch(built.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(built.body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(dropboxSignRefusal(response.status, text));
    const json = JSON.parse(text);
    if (!json.access_token) throw new Error("Dropbox Sign did not return access.");
    return json;
  }
  const headers: Record<string, string> = {};
  if (provider === "zoom" || provider === "docusign") {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  }
  const spec = setupFor(provider);
  if (!spec) throw new Error("That connection is not available.");
  const response = await fetch(spec.token, { method: "POST", headers, body });
  const text = await response.text();
  if (!response.ok) throw new Error(`${linkLabel(provider)} refused the connection. ${text.replace(/\s+/g, " ").slice(0, 220)}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error(`${linkLabel(provider)} did not return access.`);
  return json;
}
async function exchangeLinkCode(input: { code: string; redirectUri: string; verifier: string; state: string; provider: string }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier
  });
  if (input.state) body.set("state", input.state);
  if (input.provider === "adobe_sign") body.delete("code_verifier");
  if (input.provider === "outlook_calendar" || input.provider === "onedrive") body.set("scope", setupFor(input.provider)?.scope || "");
  return tokenPost(input.provider, body);
}
async function accountLabel(provider: string, accessToken2: string) {
  if (provider === "google" || provider === "google_drive") {
    const response2 = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken2}` } });
    const json2 = await response2.json();
    return json2.email || (provider === "google_drive" ? "Google Drive" : "Google Calendar");
  }
  if (provider === "zoom") {
    const response2 = await fetch("https://api.zoom.us/v2/users/me", { headers: { Authorization: `Bearer ${accessToken2}` } });
    const json2 = await response2.json();
    return json2.email || "Zoom";
  }
  if (provider === "dropbox") {
    const response2 = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken2}` }
    });
    const json2 = await response2.json();
    return json2.email || "Dropbox";
  }
  if (provider === "box") {
    const response2 = await fetch("https://api.box.com/2.0/users/me", { headers: { Authorization: `Bearer ${accessToken2}` } });
    const json2 = await response2.json();
    return json2.login || "Box";
  }
  if (provider === "onedrive") {
    const response2 = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${accessToken2}` } });
    const json2 = await response2.json();
    return json2.mail || json2.userPrincipalName || "OneDrive";
  }
  if (provider === "docusign") {
    const response2 = await fetch("https://account-d.docusign.com/oauth/userinfo", { headers: { Authorization: `Bearer ${accessToken2}` } });
    const json2 = await response2.json();
    return json2.email || "DocuSign demo";
  }
  if (provider === "adobe_sign") {
    const response2 = await fetch("https://api.na1.adobesign.com/api/rest/v6/users/me", { headers: { Authorization: `Bearer ${accessToken2}` } });
    const json2 = await response2.json();
    return json2.email || "Adobe Acrobat Sign";
  }
  if (provider === "dropbox_sign") {
    const response2 = await fetch("https://api.hellosign.com/v3/account", { headers: { Authorization: `Bearer ${accessToken2}` } });
    const json2 = await response2.json();
    return json2?.account?.email_address || "Dropbox Sign";
  }
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken2}` }
  });
  const json = await response.json();
  return json.mail || json.userPrincipalName || "Outlook Calendar";
}
async function saveAdvisorLink(input: { refreshToken?: string; provider: string; accessToken?: string; expiresIn?: number; advisorId: number }) {
  if (connectionSetupBlocked()) throw new Error(ISOLATED_EXTERNAL_BLOCK);
  if (!input.refreshToken) throw new Error(`${linkLabel(input.provider)} did not allow continued access. Connect again and accept every permission.`);
  const label = await accountLabel(input.provider, input.accessToken || "");
  await ensureLinkTables();
  const refresh = await sealSecret(input.refreshToken);
  const access = await sealSecret(input.accessToken || "");
  const expires = Date.now() + (Number(input.expiresIn) || 3600) * 1e3;
  await (await getSql())`
    insert into advisor_links (advisor_id, provider, account_label, refresh_token, access_token, expires_at)
    values (${input.advisorId}, ${input.provider}, ${label}, ${refresh}, ${access}, ${expires})
    on conflict (advisor_id, provider) do update
    set account_label = excluded.account_label,
        refresh_token = excluded.refresh_token,
        access_token = excluded.access_token,
        expires_at = excluded.expires_at
  `;
  return label;
}
function basicAuth(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
async function savedPassword(advisorId: number, provider: string) {
  await ensureLinkTables();
  const row = (await (await getSql())<{ login_user: string; login_pass: string }>`
    select login_user, login_pass from advisor_links
    where advisor_id = ${advisorId} and provider = ${provider}
  `)[0];
  if (!row?.login_user || !row.login_pass) return null;
  const password = await openSecret(row.login_pass);
  if (!password) return null;
  return { username: row.login_user, password };
}
async function calendarFeed(provider: string, username: string, password: string) {
  const start = /* @__PURE__ */ new Date();
  const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1e3);
  const stamp2 = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const url = provider === "google" ? `https://apidata.googleusercontent.com/caldav/v2/${encodeURIComponent(username)}/events` : "https://outlook.office365.com/owa/calendar";
  const response = await fetch(url, {
    method: "REPORT",
    headers: {
      Authorization: basicAuth(username, password),
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8"
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${stamp2(start)}" end="${stamp2(end)}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`
  });
  return response;
}
async function signInAdvisorPassword(advisorId: number, provider: string, username: string, password: string) {
  const user = username.trim();
  const pass = password.trim();
  if (user.length < 3 || pass.length < 6) return { ok: false as const, error: "Enter this advisor\u2019s own username and password." };
  if (provider === "google" || provider === "outlook_calendar") {
    if (provider === "outlook_calendar") {
      return { ok: false as const, error: "Outlook does not accept a password for the calendar. Press Sign in with Microsoft." };
    }
    const response = await calendarFeed(provider, user, pass);
    if (!response.ok && response.status !== 207) {
      return { ok: false as const, error: `${linkLabel(provider)} rejected this advisor\u2019s username or password.` };
    }
  }
  await ensureLinkTables();
  const sealed = await sealSecret(pass);
  await (await getSql())`
    insert into advisor_links (advisor_id, provider, account_label, login_user, login_pass)
    values (${advisorId}, ${provider}, ${user}, ${user}, ${sealed})
    on conflict (advisor_id, provider) do update
    set account_label = excluded.account_label,
        login_user = excluded.login_user,
        login_pass = excluded.login_pass
  `;
  return { ok: true as const, account: user };
}
async function listAdvisorLinkRows(advisorId: number) {
  await ensureLinkTables();
  const rows = await (await getSql())<{ provider: string; account_label: string; login_user: string; refresh_token: string }>`
    select provider, account_label, login_user, refresh_token from advisor_links where advisor_id = ${advisorId}
  `;
  const mail = (await (await getSql())<{ ms_refresh: string; mail_from: string }>`select ms_refresh, mail_from from advisors where id = ${advisorId}`)[0];
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return LINK_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    const oauth = provider === "dropbox" || provider === "box" || provider === "google_drive" || provider === "onedrive" || provider === "zoom" || provider === "dropbox_sign" || provider === "docusign" || provider === "adobe_sign";
    const mailCalendar = provider === "outlook_calendar" && Boolean(mail?.ms_refresh);
    const connected = provider === "zoom" ? Boolean(row?.refresh_token && row.refresh_token !== "s2s") : provider === "outlook_calendar" ? Boolean(row?.refresh_token) || Boolean(row?.account_label || row?.login_user) || mailCalendar : oauth ? Boolean(row?.refresh_token) : Boolean(row?.account_label || row?.login_user);
    return {
      provider,
      label: setupFor(provider)?.label ?? provider,
      connected,
      account: row?.account_label || row?.login_user || (mailCalendar ? mail?.mail_from || "Microsoft" : "")
    };
  });
}
async function connectTestCalendar(advisorId: number) {
  await ensureLinkTables();
  await (await getSql())`
    insert into advisor_links (advisor_id, provider, account_label, login_user, login_pass)
    values (${advisorId}, 'test_calendar', 'Test calendar', 'test', '')
    on conflict (advisor_id, provider) do update set account_label = 'Test calendar'
  `;
  const existing = await (await getSql())<{ id: number }>`select id from test_calendar_events where advisor_id = ${advisorId} limit 1`;
  if (!existing[0]) {
    const start = /* @__PURE__ */ new Date();
    start.setDate(start.getDate() + 1);
    start.setUTCHours(15, 0, 0, 0);
    await (await getSql())`
      insert into test_calendar_events (advisor_id, title, start_at, minutes)
      values (${advisorId}, 'Sample client review', ${start.toISOString()}, 30)
    `;
  }
  return { ok: true as const, account: "Test calendar" };
}
async function testCalendarOn(advisorId: number) {
  await ensureLinkTables();
  const row = await (await getSql())<{ account_label: string }>`
    select account_label from advisor_links where advisor_id = ${advisorId} and provider = 'test_calendar'
  `;
  return Boolean(row[0]);
}
async function readTestEvents(advisorId: number) {
  if (!await testCalendarOn(advisorId)) return [];
  const rows = await (await getSql())<{ title: string; start_at: string; minutes: number }>`
    select title, start_at, minutes from test_calendar_events
    where advisor_id = ${advisorId} and start_at >= now() - interval '1 day'
    order by start_at limit 20
  `;
  return rows.map((row) => {
    const start = new Date(row.start_at);
    const end = new Date(start.getTime() + (Number(row.minutes) || 30) * 6e4);
    return { source: "Test calendar", title: row.title, start: start.toISOString(), end: end.toISOString() };
  });
}
async function zoomAccountToken(advisorId: number) {
  const login = await savedPassword(advisorId, "zoom");
  if (!login) return null;
  const [accountId, clientId, email] = login.username.split("\n");
  if (!accountId || !clientId || !email || !login.password) return null;
  const response = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: "POST",
    headers: { Authorization: basicAuth(clientId, login.password) }
  });
  if (!response.ok) return null;
  const json = await response.json();
  if (!json.access_token) return null;
  return { token: json.access_token, email };
}
async function saveAdvisorZoom(advisorId: number, input: { email: string; accountId: string; clientId: string; clientSecret: string }) {
  if (connectionSetupBlocked()) return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK };
  const email = input.email.trim().toLowerCase();
  const accountId = input.accountId.replace(/\s/g, "");
  const clientId = input.clientId.replace(/\s/g, "");
  const clientSecret = input.clientSecret.replace(/\s/g, "");
  if (!email.includes("@") || accountId.length < 6 || clientId.length < 6 || clientSecret.length < 6) {
    return { ok: false as const, error: "Enter this advisor's Zoom email, Account ID, Client ID, and Client Secret." };
  }
  const response = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: "POST",
    headers: { Authorization: basicAuth(clientId, clientSecret) }
  });
  if (!response.ok) {
    const text = await response.text();
    let reason = "";
    try {
      const parsed = JSON.parse(text);
      reason = parsed.reason || parsed.error || "";
    } catch {
      reason = text.replace(/\s+/g, " ").slice(0, 160);
    }
    const lower = reason.toLowerCase();
    const message = lower.includes("disabled") ? "Zoom has this app turned off. Open the app and press Activate your app. Until it is activated, the keys will not work." : lower.includes("client") ? "Zoom rejected the Client ID or Client Secret. In that Zoom app, activate it first, then copy the Client ID and Client Secret again. The Account ID is a different value." : lower.includes("account") ? "Zoom rejected the Account ID. Copy the Account ID from the same app page as the Client ID." : `Zoom refused the keys. ${reason || "Activate the Server-to-Server app, then copy Account ID, Client ID, and Client Secret from that page."}`;
    return { ok: false as const, error: message };
  }
  const json = await response.json();
  if (!json.access_token) return { ok: false as const, error: "Zoom did not return access." };
  const who = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${json.access_token}` } });
  if (!who.ok) return { ok: false as const, error: "Those keys worked, but that email is not a user on this Zoom account." };
  await ensureLinkTables();
  const sealed = await sealSecret(clientSecret);
  await (await getSql())`
    insert into advisor_links (advisor_id, provider, account_label, refresh_token, login_user, login_pass)
    values (${advisorId}, 'zoom', ${email}, 's2s', ${`${accountId}
${clientId}
${email}`}, ${sealed})
    on conflict (advisor_id, provider) do update
    set account_label = excluded.account_label,
        refresh_token = 's2s',
        login_user = excluded.login_user,
        login_pass = excluded.login_pass
  `;
  return { ok: true as const, account: email };
}
async function disconnectAdvisorLink(advisorId: number, provider: string) {
  if (connectionSetupBlocked()) return;
  await ensureLinkTables();
  await (await getSql())`delete from advisor_links where advisor_id = ${advisorId} and provider = ${provider}`;
  if (provider === "test_calendar") {
    await (await getSql())`delete from test_calendar_events where advisor_id = ${advisorId}`;
  }
}
async function linkAccessToken(advisorId: number, provider: string) {
  return accessToken(advisorId, provider);
}
async function accessToken(advisorId: number, provider: string) {
  await ensureLinkTables();
  const row = (await (await getSql())<{ refresh_token: string; access_token: string; expires_at: string }>`
    select refresh_token, access_token, expires_at from advisor_links
    where advisor_id = ${advisorId} and provider = ${provider}
  `)[0];
  if ((!row?.refresh_token || row.refresh_token === "s2s") && provider === "outlook_calendar") {
    try {
      return await accessTokenForAdvisor(advisorId);
    } catch {
      return null;
    }
  }
  if (!row?.refresh_token || row.refresh_token === "s2s") return null;
  const expires = Number(row.expires_at) || 0;
  if (row.access_token && expires > Date.now() + 6e4) return openSecret(row.access_token);
  try {
    const next = await tokenPost(provider, new URLSearchParams({ grant_type: "refresh_token", refresh_token: await openSecret(row.refresh_token) }));
    const access = next.access_token;
    const refresh = next.refresh_token ? await sealSecret(next.refresh_token) : row.refresh_token;
    await (await getSql())`
      update advisor_links
      set access_token = ${await sealSecret(access)},
          refresh_token = ${refresh},
          expires_at = ${Date.now() + (Number(next.expires_in) || 3600) * 1e3}
      where advisor_id = ${advisorId} and provider = ${provider}
    `;
    return access;
  } catch {
    if (provider === "outlook_calendar") {
      try {
        return await accessTokenForAdvisor(advisorId);
      } catch {
        return null;
      }
    }
    return null;
  }
}
function graphWhen(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function whenRange(range?: { start?: string; end?: string }) {
  if (range?.start && range?.end) return { start: range.start, end: range.end };
  const start = /* @__PURE__ */ new Date();
  const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1e3);
  return { start: start.toISOString(), end: end.toISOString() };
}
async function deskSpan(advisorId: number, range = whenRange()) {
  try {
    await ensureDeskCalendar();
    const rows = await (await getSql())<{ source: string; title: string; start_at: string; minutes: number; location: string; join_url: string }>`
      select source, title, start_at, minutes, location, join_url from desk_calendar_events
      where advisor_id = ${advisorId} and start_at >= ${range.start} and start_at < ${range.end}
      order by start_at limit 24
    `;
    return rows.map((row) => {
      const start = new Date(row.start_at);
      const end = new Date(start.getTime() + (Number(row.minutes) || 30) * 6e4);
      return { source: row.source || "Desk", title: row.title || "Busy", start: start.toISOString(), end: end.toISOString(), location: row.location || "", join: row.join_url || "" };
    });
  } catch {
    return [];
  }
}
async function readCalendars(advisorId: number, range?: { start?: string; end?: string }) {
  noteLookup("calendar");
  const window = whenRange(range);
  const events: Array<{ source?: string; id?: string; title: string; start: string; end?: string; join?: string; location?: string }> = [];
  const outlookLink = await accessToken(advisorId, "outlook_calendar");
  let outlook = outlookLink;
  if (!outlook) {
    try {
      outlook = await accessTokenForAdvisor(advisorId);
    } catch {
      outlook = null;
    }
  }
  let outlookNote = "";
  if (outlook) {
    const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
    url.searchParams.set("startDateTime", window.start);
    url.searchParams.set("endDateTime", window.end);
    url.searchParams.set("$select", "id,subject,start,end,location,isOnlineMeeting,onlineMeeting");
    url.searchParams.set("$top", "50");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${outlook}`, Prefer: 'outlook.timezone="UTC"' } });
    if (!response.ok) outlookNote = "Microsoft is still signed in, but the calendar permission needs one more Sign in with Microsoft on the Calendar tab.";
    else {
      const json = await response.json();
      for (const item of json.value ?? []) {
        const place = String(item.location?.displayName || "").trim();
        const meeting = String(item.onlineMeeting?.joinUrl || "").trim();
        const placeIsLink = /^https?:\/\//i.test(place);
        events.push({ source: "Outlook", id: item.id || "", title: item.subject || "Busy", start: graphWhen(item.start?.dateTime), end: graphWhen(item.end?.dateTime), join: meeting || (placeIsLink ? place : ""), location: placeIsLink ? "" : place });
      }
    }
  }
  const google = await accessToken(advisorId, "google");
  if (google) {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", window.start);
    url.searchParams.set("timeMax", window.end);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "12");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${google}` } });
    if (response.ok) {
      const json = await response.json();
      for (const item of json.items ?? []) {
        events.push({ source: "Google", id: item.id || "", title: item.summary || "Busy", start: item.start?.dateTime || "", end: item.end?.dateTime || "", join: item.hangoutLink || "", location: item.location || "" });
      }
    }
  }
  if (!outlook && !google) {
    for (const provider of ["google", "outlook_calendar"]) {
      const login = await savedPassword(advisorId, provider);
      if (!login) continue;
      const response = await calendarFeed(provider, login.username, login.password);
      if (!response.ok && response.status !== 207) continue;
      const text = await response.text();
      const source = provider === "google" ? "Google" : "Outlook";
      for (const match of text.matchAll(/SUMMARY:(.+)/g)) {
        events.push({ source, title: match[1].trim() || "Busy", start: "", end: "" });
      }
    }
  }
  const desk = await deskSpan(advisorId, window);
  const testEvents = (await readTestEvents(advisorId)).filter((item) => {
    const time = Date.parse(item.start);
    return Number.isFinite(time) && time >= Date.parse(window.start) && time < Date.parse(window.end);
  });
  const merged = [...events, ...desk, ...testEvents];
  if (!outlook && !google && merged.length === 0) {
    return { connected: false, events: merged, error: "Outlook is not signed in. Open the Calendar tab and press Sign in with Microsoft." };
  }
  return { connected: true, events: merged, ...outlookNote ? { error: outlookNote } : {} };
}
async function readZoom(advisorId: number) {
  noteLookup("zoom");
  const token = await accessToken(advisorId, "zoom");
  if (!token) return { connected: false, error: "Zoom is not signed in. Press Sign in with Zoom." };
  const response = await fetch("https://api.zoom.us/v2/users/me/meetings?type=upcoming&page_size=12", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return { connected: true, error: "Zoom did not return the meetings. Press Sign in with Zoom again." };
  const json = await response.json();
  return {
    connected: true,
    meetings: (json.meetings ?? []).map((item: { id: unknown; topic: string; start_time: string; duration: number; join_url: string }) => ({
      id: item.id ? String(item.id) : "",
      topic: item.topic || "Meeting",
      start: item.start_time || "",
      minutes: item.duration || 0,
      join: item.join_url || ""
    }))
  };
}
async function readDropboxText(advisorId: number, path: string) {
  const safe = path.trim();
  if (!safe.startsWith("/") || safe.includes("..") || safe.length > 400) {
    return { ok: false as const, error: "The Dropbox path must start with / , such as /Unique Advisor/clients.csv." };
  }
  const token = await accessToken(advisorId, "dropbox");
  if (!token) return { ok: false as const, error: "Dropbox is not connected. Connect it in Settings, then choose the file again." };
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path: safe })
    }
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 160);
    return { ok: false as const, error: `Dropbox could not open that file. ${detail}` };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 15e5) return { ok: false as const, error: "That file is too large. Use a CSV under 1.5 MB." };
  const text = bytes.toString("utf8");
  if (text.includes("\0")) return { ok: false as const, error: "That file is not a text list. Use CSV or JSON." };
  return { ok: true as const, text };
}
async function readDropbox(advisorId: number) {
  noteLookup("files");
  const token = await accessToken(advisorId, "dropbox");
  const login = token ? null : await savedPassword(advisorId, "dropbox");
  if (!token && !login) return { connected: false, error: "Dropbox is not connected." };
  const response = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: {
      Authorization: token ? `Bearer ${token}` : basicAuth(login?.username || "", login?.password || ""),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ path: "", limit: 20 })
  });
  if (!response.ok) return { connected: true, error: "Dropbox rejected this advisor\u2019s username or password." };
  const json = await response.json();
  return { connected: true, files: (json.entries ?? []).map((item: { name: string }) => item.name || "Untitled") };
}
function stamp(value: string) {
  const text = value.trim().replace(" ", "T");
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!match) {
    const parsed2 = new Date(text);
    if (Number.isNaN(parsed2.getTime())) return "";
    return parsed2.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  const zone = match[5] || "Z";
  const offset = zone.toUpperCase() === "Z" ? "Z" : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const parsed = /* @__PURE__ */ new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4] || "00"}${offset}`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}
async function createCalendarEvent(advisorId: number, input: { timeZone?: string; localStart?: string; localEnd?: string; start?: string; minutes?: number; provider: string; title?: string; details?: string; location?: string }) {
  if (previewWritesBlocked()) return { ok: false as const, error: PREVIEW_WRITE_BLOCK };
  const zoned = Boolean(input.timeZone && input.localStart && input.localEnd);
  const start = zoned ? input.localStart || "" : stamp(input.start || "");
  const end = zoned ? input.localEnd || "" : "";
  if (!start) return { ok: false as const, error: "The meeting time could not be read. Ask again with a date and a time." };
  const endDate = zoned ? null : new Date(new Date(start).getTime() + (Number(input.minutes) || 30) * 6e4);
  const endStamp = zoned ? end : endDate ? endDate.toISOString().replace(/\.\d{3}Z$/, "Z") : "";
  const zone = input.timeZone || "UTC";
  if (input.provider === "outlook_calendar") {
    let token = await accessToken(advisorId, "outlook_calendar");
    if (!token) {
      try {
        token = await accessTokenForAdvisor(advisorId);
      } catch {
        token = null;
      }
    }
    if (token) {
      const response = await fetch("https://graph.microsoft.com/v1.0/me/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: input.title,
          body: { contentType: "Text", content: input.details || input.title },
          location: input.location ? { displayName: input.location } : void 0,
          start: { dateTime: zoned ? start : start.slice(0, 19), timeZone: zone },
          end: { dateTime: zoned ? endStamp : endStamp.slice(0, 19), timeZone: zone }
        })
      });
      if (response.ok) {
        const json = await response.json();
        return { ok: true as const, detail: "Added to Outlook Calendar.", eventId: String(json.id || "") };
      }
      const reason = (await response.text()).replace(/\s+/g, " ").slice(0, 280);
      return { ok: false as const, error: `Outlook did not add the event: ${reason || response.status}` };
    }
  } else {
    const token = await accessToken(advisorId, "google");
    if (token) {
      const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ summary: input.title, description: input.details || input.title, location: input.location || "", start: { dateTime: zoned ? start : start, timeZone: zone }, end: { dateTime: zoned ? endStamp : endStamp, timeZone: zone } })
      });
      if (response.ok) {
        const json = await response.json();
        return { ok: true as const, detail: "Added to Google Calendar.", eventId: String(json.id || "") };
      }
    }
  }
  return { ok: false as const, error: input.provider === "outlook_calendar" ? "Outlook Calendar is not connected." : "Google Calendar is not connected." };
}
async function createZoomMeeting(advisorId: number, input: { start?: string; title: string; minutes: number }) {
  if (previewWritesBlocked()) return { ok: false as const, error: PREVIEW_WRITE_BLOCK };
  const start = stamp(input.start || "");
  if (!start) return { ok: false as const, error: "The meeting time could not be read. Ask again with a date and a time." };
  const token = await accessToken(advisorId, "zoom");
  if (!token) return { ok: false as const, error: "Zoom is not signed in. Press Sign in with Zoom." };
  const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ topic: input.title, type: 2, start_time: start, duration: input.minutes, timezone: "UTC" })
  });
  if (!response.ok) return { ok: false as const, error: "Zoom did not create the meeting." };
  const json = await response.json();
  return { ok: true as const, detail: json.join_url ? `Zoom meeting created. Join link: ${json.join_url}` : "Zoom meeting created." };
}
async function saveDropboxNote(advisorId: number, input: { name: string; content: string }) {
  if (previewWritesBlocked() || externalSideEffectsBlocked()) return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK };
  const token = await accessToken(advisorId, "dropbox");
  if (!token) return { ok: false as const, error: "Dropbox is not connected." };
  const safe = input.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "note";
  const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path: `/Unique Advisor/${safe}.txt`, mode: "add", autorename: true })
    },
    body: input.content
  });
  if (!response.ok) return { ok: false as const, error: "Dropbox did not save the note." };
  return { ok: true as const, detail: `Saved ${safe}.txt in the Dropbox folder Unique Advisor.` };
}
async function prepareLink(provider: string) {
  const config = await appConfig(provider);
  if (!config) return null;
  return config;
}
async function createLinkAuthorization(input: { provider: string; redirectUri: string; request: Request; advisorId: number; slug: string }) {
  if (connectionSetupBlocked()) return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK };
  if (!isLinkProvider(input.provider)) return { ok: false as const, error: "That connection is not available." };
  let config;
  try {
    config = await prepareLink(input.provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The saved app secret could not be read.";
    return { ok: false as const, error: message };
  }
  if (!config) {
    return { ok: false as const, error: "This connection is not set up yet. Add the app in Superadmin, then try again." };
  }
  let redirectUri = "";
  try {
    redirectUri = assertLinkCallback(input.redirectUri, input.request);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "The return address is not valid." };
  }
  const { verifier, challenge } = createLinkPkce();
  const state = randomBytes(24).toString("base64url");
  await ensureLinkTables();
  const sql = await getSql();
  await sql`delete from oauth_states where advisor_id = ${input.advisorId} and provider = ${input.provider}`;
  await sql`
    insert into oauth_states (state, advisor_id, slug, verifier, redirect_uri, display_name, provider)
    values (${state}, ${input.advisorId}, ${input.slug}, ${verifier}, ${redirectUri}, ${""}, ${input.provider})
  `;
  return { ok: true as const, url: linkAuthorizeUrl({ provider: input.provider, clientId: config.clientId, redirectUri, state, challenge }) };
}
async function ensureDeskCalendar() {
  await ensureLinkTables();
  await (await getSql()).query(`create table if not exists desk_calendar_events (
    id serial primary key,
    advisor_id integer not null references advisors(id) on delete cascade,
    source text not null,
    title text not null,
    start_at timestamptz not null,
    minutes integer not null default 30,
    external_id text not null default ''
  )`);
  await (await getSql()).query("alter table desk_calendar_events add column if not exists external_id text not null default ''");
  await (await getSql()).query("alter table desk_calendar_events add column if not exists location text not null default ''");
  await (await getSql()).query("alter table desk_calendar_events add column if not exists join_url text not null default ''");
}
function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0));
  return { start, end };
}
function stampCompact(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function parseIcsTime(raw: string) {
  const value = raw.trim();
  const zoned = value.match(/(\d{8}T\d{6})Z/);
  const local = value.match(/(\d{8}T\d{6})/);
  const day = value.match(/(\d{8})/);
  const hit = zoned?.[1] || local?.[1];
  if (hit) {
    const iso = `${hit.slice(0, 4)}-${hit.slice(4, 6)}-${hit.slice(6, 8)}T${hit.slice(9, 11)}:${hit.slice(11, 13)}:${hit.slice(13, 15)}${zoned ? "Z" : ""}`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (day) {
    const date = /* @__PURE__ */ new Date(`${day[1].slice(0, 4)}-${day[1].slice(4, 6)}-${day[1].slice(6, 8)}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
function eventsFromIcs(text: string, source: string) {
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const events: Array<{ source: string; title: string; start: string; minutes: number; externalId: string }> = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const title = (block.match(/SUMMARY:(.*)/) || [])[1]?.replace(/\\n/g, " ").replace(/\\,/g, ",").trim() || "Busy";
    const start = parseIcsTime((block.match(/DTSTART[^:]*:(.*)/) || [])[1] || "");
    const end = parseIcsTime((block.match(/DTEND[^:]*:(.*)/) || [])[1] || "");
    if (!start) continue;
    const minutes = end ? Math.max(15, Math.round((end.getTime() - start.getTime()) / 6e4)) : 30;
    const externalId = (block.match(/UID:(.*)/) || [])[1]?.trim() || "";
    events.push({ source, title: title.slice(0, 120), start: start.toISOString(), minutes, externalId });
  }
  return events;
}
async function davRequest(url: string, username: string, password: string, method: string, body: string, depth = "0") {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(current, {
      method,
      redirect: "manual",
      headers: {
        Authorization: basicAuth(username, password),
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8",
        "User-Agent": "UniqueAdvisor"
      },
      body
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      current = absoluteUrl(current, location);
      continue;
    }
    return response;
  }
  return fetch(current, {
    method,
    redirect: "manual",
    headers: {
      Authorization: basicAuth(username, password),
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8"
    },
    body
  });
}
function xmlHrefs(xml: string) {
  return [...xml.matchAll(/<(?:[A-Za-z0-9]+:)?href\b[^>]*>([^<]+)<\/(?:[A-Za-z0-9]+:)?href>/gi)].map((match) => decodeURIComponent(match[1].replace(/&/g, "&").trim())).filter((href) => href.length > 0 && href !== "/");
}
function absoluteUrl(base: string | URL, href: string) {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return new URL(base).origin + href;
  return new URL(href, base).toString();
}
async function icloudCollection(username: string, password: string) {
  const root = await davRequest(
    "https://caldav.icloud.com/",
    username,
    password,
    "PROPFIND",
    `<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`
  );
  if (root.status === 401 || root.status === 403) return { ok: false as const, error: "unauthorized" };
  if (!root.ok && root.status !== 207) return { ok: false as const, error: "iCloud calendar could not be reached." };
  const rootXml = await root.text();
  const rootHrefs = xmlHrefs(rootXml);
  const principalHref = rootHrefs.find((item) => /principal/i.test(item));
  if (!principalHref) return { ok: false as const, error: "iCloud did not return this Apple ID's calendar." };
  const principal = absoluteUrl("https://caldav.icloud.com/", principalHref);
  const homeResponse = await davRequest(
    principal,
    username,
    password,
    "PROPFIND",
    `<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`
  );
  const homeXml = await homeResponse.text();
  const homeHref = xmlHrefs(homeXml).find((item) => /\/calendars\/?/i.test(item)) || xmlHrefs(homeXml).find((item) => /calendar/i.test(item));
  if (!homeHref) return { ok: false as const, error: "iCloud did not return a calendar folder." };
  const home = absoluteUrl(principal, homeHref);
  const list = await davRequest(home, username, password, "PROPFIND", `<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`, "1");
  const listXml = await list.text();
  const homePath = home.replace(/\/$/, "");
  const calendars = xmlHrefs(listXml).map((href) => absoluteUrl(home, href)).filter((href) => href.replace(/\/$/, "") !== homePath && href.startsWith(homePath));
  const calendar = calendars.find((href) => /\/home\/?$/i.test(href)) || calendars[0] || home;
  return { ok: true as const, calendar };
}
async function reportEvents(url: string, username: string, password: string, start: Date, end: Date, source: string) {
  const response = await davRequest(
    url,
    username,
    password,
    "REPORT",
    `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${stampCompact(start)}" end="${stampCompact(end)}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`,
    "1"
  );
  if (response.status === 401 || response.status === 403) return { ok: false as const, error: `${source} rejected the username or password.` };
  if (!response.ok && response.status !== 207) return { ok: false as const, error: `${source} could not be read.` };
  return { ok: true as const, events: eventsFromIcs(await response.text(), source) };
}
async function pullProvider(advisorId: number, source: string, start: Date, end: Date) {
  if (source === "desk") return { ok: true as const, events: [] };
  if (source === "icloud") {
    const login2 = await savedPassword(advisorId, "icloud");
    if (!login2) return { ok: false as const, error: "Sign in to iCloud first. Use an Apple ID and an app-specific password." };
    const found = await icloudCollection(login2.username, login2.password);
    if (!found.ok) return found;
    return reportEvents(found.calendar, login2.username, login2.password, start, end, "iCloud");
  }
  const provider = source === "google" ? "google" : "outlook_calendar";
  const label = source === "google" ? "Google" : "Outlook";
  let token = await accessToken(advisorId, provider);
  if (!token && source === "outlook") {
    try {
      token = await accessTokenForAdvisor(advisorId);
    } catch {
      token = null;
    }
  }
  if (token && source === "outlook") {
    const url2 = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
    url2.searchParams.set("startDateTime", start.toISOString());
    url2.searchParams.set("endDateTime", end.toISOString());
    url2.searchParams.set("$select", "id,subject,start,end,location,onlineMeeting");
    url2.searchParams.set("$top", "80");
    const response = await fetch(url2, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } });
    if (!response.ok) return { ok: false as const, error: response.status === 403 ? "Microsoft is signed in, but the calendar was not allowed yet. Press Sign in with Microsoft again and accept the calendar." : "Outlook Calendar refused the request. Press Sign in with Microsoft again." };
    const json = await response.json();
    return {
      ok: true as const,
      events: (json.value || []).map((item: { start?: { dateTime?: string }; end?: { dateTime?: string }; subject?: string; id?: string }) => {
        const startAt = graphWhen(item.start?.dateTime || "");
        const endAt = graphWhen(item.end?.dateTime || "");
        const startDate = startAt ? new Date(startAt) : /* @__PURE__ */ new Date(NaN);
        const endDate = endAt ? new Date(endAt) : /* @__PURE__ */ new Date(NaN);
        const minutes = Number.isNaN(endDate.getTime()) || Number.isNaN(startDate.getTime()) ? 30 : Math.max(15, Math.round((endDate.getTime() - startDate.getTime()) / 6e4));
        return { source: "Outlook", title: item.subject || "Busy", start: startAt, minutes, externalId: String(item.id || "") };
      }).filter((item: { start: string }) => item.start && !Number.isNaN(new Date(item.start).getTime()))
    };
  }
  if (token && source === "google") {
    const url2 = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url2.searchParams.set("timeMin", start.toISOString());
    url2.searchParams.set("timeMax", end.toISOString());
    url2.searchParams.set("singleEvents", "true");
    url2.searchParams.set("orderBy", "startTime");
    url2.searchParams.set("maxResults", "80");
    const response = await fetch(url2, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return { ok: false as const, error: "Google Calendar refused the request. Connect it again." };
    const json = await response.json();
    return {
      ok: true as const,
      events: (json.items || []).map((item: { start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; summary?: string; id?: string }) => {
        const startAt = new Date(item.start?.dateTime || item.start?.date || "");
        const endAt = new Date(item.end?.dateTime || item.end?.date || "");
        const minutes = Number.isNaN(endAt.getTime()) ? 30 : Math.max(15, Math.round((endAt.getTime() - startAt.getTime()) / 6e4));
        return { source: "Google", title: item.summary || "Busy", start: startAt.toISOString(), minutes, externalId: String(item.id || "") };
      }).filter((item: { start: string }) => item.start && !Number.isNaN(new Date(item.start).getTime()))
    };
  }
  const login = await savedPassword(advisorId, provider);
  if (!login) return { ok: false as const, error: `Sign in to ${label} first.` };
  const url = source === "google" ? `https://apidata.googleusercontent.com/caldav/v2/${encodeURIComponent(login.username)}/events/` : "https://outlook.office365.com/owa/calendar";
  return reportEvents(url, login.username, login.password, start, end, label);
}
function applePasswordChoices(raw: string) {
  const cleaned = raw.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s/g, "");
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const dashed = letters.length === 16 ? `${letters.slice(0, 4)}-${letters.slice(4, 8)}-${letters.slice(8, 12)}-${letters.slice(12)}` : "";
  return [...new Set([cleaned, dashed, letters].filter((item) => item.length >= 6))];
}
async function isNormalApplePassword(username: string, password: string) {
  const response = await fetch(`https://setup.icloud.com/setup/authenticate/${encodeURIComponent(username)}`, {
    method: "POST",
    headers: { Authorization: basicAuth(username, password), Origin: "https://www.icloud.com" }
  });
  return response.status === 409;
}
async function connectIcloudCalendar(advisorId: number, username: string, password: string) {
  const user = username.trim().toLowerCase();
  const choices = applePasswordChoices(password);
  if (!user.includes("@") || choices.length === 0) {
    return { ok: false as const, error: "Enter the Apple ID email you use at appleid.apple.com, and the app-specific password Apple showed as four groups." };
  }
  let found = null;
  let used = choices[0];
  for (const choice of choices) {
    found = await icloudCollection(user, choice);
    used = choice;
    if (found.ok) break;
    if (found.error !== "unauthorized") break;
  }
  if (!found?.ok) {
    if (found?.error === "unauthorized") {
      const normal = await isNormalApplePassword(user, choices[0]).catch(() => false);
      if (normal) {
        return { ok: false as const, error: "That is your normal Apple ID password. Create an app-specific password at appleid.apple.com under Sign-In and Security, then paste all four groups." };
      }
      const length = choices[0].length;
      const shape = length === 19 || length === 16 ? "The length looks right." : `An app password is 19 characters with the dashes. This one is ${length} characters.`;
      return { ok: false as const, error: `Apple refused ${user}. ${shape} Use the same email you sign in with at appleid.apple.com, not a different iCloud address. Then create a new app-specific password and paste all four groups.` };
    }
    return found || { ok: false, error: "iCloud calendar could not be reached." };
  }
  await ensureLinkTables();
  const sealed = await sealSecret(used);
  await (await getSql())`
    insert into advisor_links (advisor_id, provider, account_label, login_user, login_pass)
    values (${advisorId}, 'icloud', ${user}, ${user}, ${sealed})
    on conflict (advisor_id, provider) do update
    set account_label = excluded.account_label, login_user = excluded.login_user, login_pass = excluded.login_pass
  `;
  return { ok: true as const, account: user };
}
async function calendarAccounts(advisorId: number) {
  await ensureLinkTables();
  const rows = await (await getSql())<{ provider: string; account_label: string }>`
    select provider, account_label from advisor_links where advisor_id = ${advisorId}
  `;
  const has = (provider: string) => rows.some((row) => row.provider === provider);
  const mail = await (await getSql())<{ ms_refresh: string; mail_from: string }>`select ms_refresh, mail_from from advisors where id = ${advisorId}`;
  const outlookMail = Boolean(mail[0]?.ms_refresh);
  return {
    google: has("google"),
    outlook: has("outlook_calendar") || outlookMail,
    icloud: has("icloud"),
    googleAccount: rows.find((row) => row.provider === "google")?.account_label || "",
    outlookAccount: rows.find((row) => row.provider === "outlook_calendar")?.account_label || (outlookMail ? mail[0]?.mail_from || "Microsoft" : ""),
    icloudAccount: rows.find((row) => row.provider === "icloud")?.account_label || ""
  };
}
async function loadDeskCalendar(advisorId: number, year: number, month: number) {
  await ensureDeskCalendar();
  const { start, end } = monthRange(year, month);
  const rows = await (await getSql())<{ id: number; source: string; title: string; start_at: string; minutes: number; location: string }>`
    select id, source, title, start_at, minutes, location from desk_calendar_events
    where advisor_id = ${advisorId} and start_at >= ${start.toISOString()} and start_at < ${end.toISOString()}
    order by start_at
  `;
  const events = rows.map((row) => ({ id: Number(row.id), source: row.source, title: row.title, start: new Date(row.start_at).toISOString(), minutes: Number(row.minutes) || 30, location: String(row.location || "") }));
  await (await getSql()).query("alter table advisors add column if not exists time_zone text not null default 'America/Toronto'");
  const zone = (await (await getSql())<{ time_zone: string }>`select time_zone from advisors where id = ${advisorId}`)[0];
  return { events, accounts: await calendarAccounts(advisorId), timeZone: safeZone(zone?.time_zone || "America/Toronto") };
}
async function syncDeskCalendar(advisorId: number, source: string, year: number, month: number) {
  await ensureDeskCalendar();
  const { start, end } = monthRange(year, month);
  const pulled = await pullProvider(advisorId, source, start, end);
  if (!pulled.ok) return pulled;
  const label = source === "google" ? "Google" : source === "outlook" ? "Outlook" : "iCloud";
  await (await getSql())`
    delete from desk_calendar_events
    where advisor_id = ${advisorId} and source = ${label} and start_at >= ${start.toISOString()} and start_at < ${end.toISOString()}
  `;
  for (const event of pulled.events) {
    const at = new Date(event.start);
    if (!event.start || Number.isNaN(at.getTime())) continue;
    await (await getSql())`
      insert into desk_calendar_events (advisor_id, source, title, start_at, minutes, external_id)
      values (${advisorId}, ${event.source}, ${event.title}, ${at.toISOString()}, ${event.minutes}, ${event.externalId || ""})
    `;
  }
  const loaded = await loadDeskCalendar(advisorId, year, month);
  return { ok: true as const, count: pulled.events.length, ...loaded };
}
async function addDeskCalendarEvent(advisorId: number, input: { title: string; start: string; minutes: number; source: string }) {
  await ensureDeskCalendar();
  const title = input.title.trim().slice(0, 120);
  const start = new Date(input.start);
  const minutes = Math.min(480, Math.max(15, Number(input.minutes) || 30));
  if (title.length < 2 || Number.isNaN(start.getTime())) return { ok: false as const, error: "Add a title and a date." };
  const source = input.source === "google" ? "google" : input.source === "outlook" ? "outlook" : input.source === "icloud" ? "icloud" : "desk";
  const label = source === "google" ? "Google" : source === "outlook" ? "Outlook" : source === "icloud" ? "iCloud" : "Desk";
  if (source !== "desk" && previewWritesBlocked()) return { ok: false as const, error: PREVIEW_WRITE_BLOCK };
  let externalId = "";
  if (source === "google" || source === "outlook") {
    const accounts = await calendarAccounts(advisorId);
    const connected = source === "google" ? accounts.google : accounts.outlook;
    if (!connected) return { ok: false as const, error: `Sign in to ${label} first.` };
    const pushed = await createCalendarEvent(advisorId, {
      provider: source === "google" ? "google" : "outlook_calendar",
      title,
      start: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
      minutes
    });
    if (!pushed.ok) return pushed;
    externalId = "eventId" in pushed ? pushed.eventId || "" : "";
  }
  if (source === "icloud") {
    const login = await savedPassword(advisorId, "icloud");
    if (!login) return { ok: false as const, error: "Sign in to iCloud first." };
    const found = await icloudCollection(login.username, login.password);
    if (!found.ok) return found;
    const end = new Date(start.getTime() + minutes * 6e4);
    const uid = `${Date.now()}@uniqueadvisor`;
    externalId = uid;
    const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Unique Advisor//EN\r
BEGIN:VEVENT\r
UID:${uid}\r
DTSTAMP:${stampCompact(/* @__PURE__ */ new Date())}\r
DTSTART:${stampCompact(start)}\r
DTEND:${stampCompact(end)}\r
SUMMARY:${title.replace(/[,\\]/g, " ")}\r
END:VEVENT\r
END:VCALENDAR\r
`;
    const response = await fetch(`${found.calendar.replace(/\/$/, "")}/${uid}.ics`, {
      method: "PUT",
      headers: { Authorization: basicAuth(login.username, login.password), "Content-Type": "text/calendar; charset=utf-8" },
      body: ics
    });
    if (!response.ok && response.status !== 201 && response.status !== 204) {
      return { ok: false as const, error: "iCloud did not add the event." };
    }
  }
  await (await getSql())`
    insert into desk_calendar_events (advisor_id, source, title, start_at, minutes, external_id)
    values (${advisorId}, ${label}, ${title}, ${start.toISOString()}, ${minutes}, ${externalId})
  `;
  return { ok: true as const };
}
async function inspectDropboxClient(advisorId: number, query: { clientId: string; email: string; policy: unknown }) {
  const token = await accessToken(advisorId, "dropbox");
  if (!token) return { ok: false as const, error: "Dropbox is not connected." };
  const needle = String(query.clientId || query.email || query.policy || "").trim().toLowerCase();
  if (!needle) return { ok: false as const, error: "A name is not enough to open a client folder." };
  const response = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: "/Unique Advisor/Assistant Test", recursive: true, limit: 80 }),
  });
  if (!response.ok) return { ok: false as const, error: "Dropbox did not list files. I did not open another folder." };
  const json = await response.json();
  const files = (json.entries ?? []).filter((item: { path_lower?: string; ".tag"?: string }) => item[".tag"] === "file" && String(item.path_lower || "").includes(needle));
  const folders = [...new Set(files.map((item: { path_lower: string }) => String(item.path_lower || "").split("/").slice(0, -1).join("/")))];
  if (!files.length) return { ok: true as const, detail: "No file path matched that client ID, email, or policy number. I did not open other clients' files." };
  if (folders.length > 1) return { ok: true as const, detail: "More than one folder matches that identifier. I did not mix them." };
  const lines = files.slice(0, 8).map((item: { name: string; server_modified: string }) => `- ${item.name || "file"} — ${item.server_modified || "date unknown"}`);
  return { ok: true as const, detail: `Files in the matching folder:\n${lines.join("\n")}\nI did not submit or overwrite anything.` };
}

function sqlFlag(value: unknown) {
  return value === true || value === "t" || value === "true" || value === 1;
}

/** True when a refresh token is stored. Never returns the token. Null means the check failed. */
async function storedAdvisorLink(advisorId: number, provider: string): Promise<boolean | null> {
  try {
    await ensureLinkTables();
    const row = (await (await getSql())`
      select (length(coalesce(refresh_token, '')) > 0) as stored
      from advisor_links
      where advisor_id = ${advisorId} and provider = ${provider}
      limit 1
    `)[0] as { stored?: unknown } | undefined;
    return sqlFlag(row?.stored);
  } catch {
    return null;
  }
}

/** True when a mailbox refresh token is stored. Never returns the token. Null means the check failed. */
async function storedMailboxLink(advisorId: number): Promise<boolean | null> {
  try {
    const row = (await (await getSql())`
      select (length(coalesce(ms_refresh, '')) > 0) as stored
      from advisors
      where id = ${advisorId}
      limit 1
    `)[0] as { stored?: unknown } | undefined;
    return sqlFlag(row?.stored);
  } catch {
    return null;
  }
}

export {
  LINK_PROVIDERS,
  accessToken,
  addDeskCalendarEvent,
  assertLinkCallback,
  calendarAccounts,
  connectIcloudCalendar,
  connectTestCalendar,
  createCalendarEvent,
  createLinkAuthorization,
  createLinkPkce,
  createZoomMeeting,
  disconnectAdvisorLink,
  ensureLinkTables,
  exchangeLinkCode,
  isLinkProvider,
  linkAccessToken,
  linkAppStatus,
  linkAuthorizeUrl,
  linkLabel,
  listAdvisorLinkRows,
  loadDeskCalendar,
  prepareLink,
  readCalendars,
  readDropbox,
  readDropboxText,
  inspectDropboxClient,
  readZoom,
  saveAdvisorLink,
  saveAdvisorZoom,
  saveDropboxNote,
  saveLinkApp,
  signInAdvisorPassword,
  storedAdvisorLink,
  storedMailboxLink,
  syncDeskCalendar,
  takeLinkState,
  testCalendarOn
};
