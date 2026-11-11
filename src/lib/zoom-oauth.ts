import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";
import { ensureLinkTables, saveAdvisorLink } from "@/lib/advisor-links";
import { openSecret, signingKey } from "@/lib/microsoft-mail";

export const ZOOM_REDIRECT = "https://youradviser.grok.me/api/zoom/callback";

async function zoomApp() {
  await ensureLinkTables();
  const row = (await (await getSql())<{ client_id: string; client_secret: string }>`
    select client_id, client_secret from link_apps where provider = 'zoom'
  `)[0];
  if (!row?.client_id || !row.client_secret) return null;
  const clientSecret = await openSecret(row.client_secret);
  if (!clientSecret) return null;
  return { clientId: row.client_id, clientSecret };
}

function signState(body: string, key: Buffer) {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export async function beginZoomSignIn(advisorId: number, slug: string) {
  const app = await zoomApp();
  if (!app) return { ok: false as const, error: "Add the Zoom app in Superadmin first." };
  const nonce = randomBytes(18).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ id: advisorId, n: nonce, e: Date.now() + 20 * 60 * 1000 })).toString("base64url");
  const state = `${payload}.${signState(payload, await signingKey())}`;
  await ensureLinkTables();
  const sql = await getSql();
  await sql`delete from oauth_states where advisor_id = ${advisorId} and provider = 'zoom'`;
  await sql`
    insert into oauth_states (state, advisor_id, slug, verifier, redirect_uri, display_name, provider)
    values (${nonce}, ${advisorId}, ${slug}, ${""}, ${ZOOM_REDIRECT}, ${""}, ${"zoom"})
  `;
  const url = new URL("https://zoom.us/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", ZOOM_REDIRECT);
  url.searchParams.set("state", state);
  return { ok: true as const, url: url.toString() };
}

async function readState(state: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = signState(payload, await signingKey());
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  let parsed: { id?: number; n?: string; e?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { id?: number; n?: string; e?: number };
  } catch {
    return null;
  }
  if (!parsed.id || !parsed.n || !parsed.e || parsed.e < Date.now()) return null;
  await ensureLinkTables();
  const row = (await (await getSql())<{ advisor_id: number; slug: string }>`
    delete from oauth_states where state = ${parsed.n} and provider = 'zoom' and advisor_id = ${parsed.id}
    returning advisor_id, slug
  `)[0];
  if (!row) return null;
  return { advisorId: Number(row.advisor_id), slug: row.slug };
}

function deskUrl(slug: string, zoom: string, detail = "") {
  const next = new URL(`/a/${encodeURIComponent(slug)}/desk`, "https://youradviser.grok.me");
  next.searchParams.set("zoom", zoom);
  if (detail) next.searchParams.set("detail", detail.slice(0, 280));
  return next.toString();
}

export async function completeZoomSignIn(request: Request) {
  const current = new URL(request.url);
  const state = current.searchParams.get("state") ?? "";
  const saved = state ? await readState(state).catch(() => null) : null;
  if (!saved) return Response.redirect(deskUrl("unknown", "error", "This Zoom sign-in link expired. Press Sign in with Zoom again."), 302);
  const oauthError = current.searchParams.get("error_description") || current.searchParams.get("error") || "";
  if (oauthError) return Response.redirect(deskUrl(saved.slug, "error", oauthError), 302);
  const code = current.searchParams.get("code") ?? "";
  if (!code) return Response.redirect(deskUrl(saved.slug, "error", "Zoom did not return a sign-in code."), 302);
  try {
    const app = await zoomApp();
    if (!app) return Response.redirect(deskUrl(saved.slug, "error", "Add the Zoom app in Superadmin first."), 302);
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: ZOOM_REDIRECT });
    const response = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const text = await response.text();
    if (!response.ok) return Response.redirect(deskUrl(saved.slug, "error", text.replace(/\s+/g, " ").slice(0, 220)), 302);
    const tokens = JSON.parse(text) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tokens.access_token || !tokens.refresh_token) {
      return Response.redirect(deskUrl(saved.slug, "error", "Zoom did not allow continued access. Sign in again and approve."), 302);
    }
    await saveAdvisorLink({
      advisorId: saved.advisorId,
      provider: "zoom",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: Number(tokens.expires_in) || 3600,
    });
    return Response.redirect(deskUrl(saved.slug, "connected"), 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoom sign-in failed.";
    return Response.redirect(deskUrl(saved.slug, "error", message), 302);
  }
}
