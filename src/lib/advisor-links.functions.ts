import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { gateAdvisor, gateOperator } from "@/lib/advisor-db";
import {
  assertLinkCallback,
  createLinkPkce,
  disconnectAdvisorLink,
  ensureLinkTables,
  isLinkProvider,
  linkAppStatus,
  linkAuthorizeUrl,
  listAdvisorLinkRows,
  prepareLink,
  saveLinkApp,
  saveAdvisorZoom,
  signInAdvisorPassword,
  loadDeskCalendar,
  syncDeskCalendar,
  addDeskCalendarEvent,
  connectIcloudCalendar,
  type LinkProvider,
} from "@/lib/advisor-links";
import { beginZoomSignIn } from "@/lib/zoom-oauth";
import { getSql } from "@/lib/db";
import { fileSettings, listDeskNotices, listUpcomingMeetings, clearDeskNotices, saveFileSettings, advisorZone, saveAdvisorZone, cancelBookedMeeting } from "@/lib/zoom-bookings";

export const loadLinkApps = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code);
    if (!gate.ok) return gate;
    return { ok: true as const, apps: await linkAppStatus() };
  });

export const saveConnectionApp = createServerFn({ method: "POST" })
  .validator((input: { code: string; provider: string; clientId: string; clientSecret: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code);
    if (!gate.ok) return gate;
    if (!isLinkProvider(data.provider) || data.provider === "outlook_calendar") {
      return { ok: false as const, error: "Outlook Calendar uses the Microsoft app already saved under Settings." };
    }
    const clientId = data.clientId.trim();
    const clientSecret = data.clientSecret.trim();
    if (clientId.length < 6 || clientSecret.length < 6) return { ok: false as const, error: "Paste both the app ID and the secret." };
    await saveLinkApp(data.provider, clientId, clientSecret);
    return { ok: true as const, apps: await linkAppStatus() };
  });

export const listConnectionStatus = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const apps = await linkAppStatus();
    const links = await listAdvisorLinkRows(gate.row.id);
    return {
      ok: true as const,
      links: links.map((link) => ({
        ...link,
        ready: apps.find((app) => app.provider === link.provider)?.configured ?? false,
      })),
    };
  });

export const signInConnection = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; provider: string; username: string; password: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    if (!isLinkProvider(data.provider)) return { ok: false as const, error: "That connection is not available." };
    return signInAdvisorPassword(gate.row.id, data.provider, data.username, data.password);
  });

export const beginZoomConnect = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    return beginZoomSignIn(gate.row.id, gate.row.slug);
  });

export const connectZoomAccount = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; email: string; accountId: string; clientId: string; clientSecret: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    return saveAdvisorZoom(gate.row.id, data);
  });

export const beginConnection = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; provider: string; redirectUri: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    if (!isLinkProvider(data.provider)) return { ok: false as const, error: "That connection is not available." };
    const provider = data.provider as LinkProvider;
    const config = await prepareLink(provider);
    if (!config) {
      return {
        ok: false as const,
        error: provider === "outlook_calendar"
          ? "Outlook Calendar uses the Microsoft app. Save that app in Settings first."
          : "This connection is not set up yet. Add the app in Superadmin, then try again.",
      };
    }
    const fixed = provider === "box"
      ? "https://youradviser.grok.me/api/box/callback"
      : provider === "google_drive"
        ? "https://youradviser.grok.me/api/google/callback"
        : provider === "dropbox"
          ? "https://youradviser.grok.me/api/link/callback"
          : "";
    let redirectUri = fixed;
    if (!redirectUri) {
      try {
        redirectUri = assertLinkCallback(data.redirectUri, getRequest());
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "The return address is not valid." };
      }
    }
    const { verifier, challenge } = createLinkPkce();
    const state = randomBytes(24).toString("base64url");
    await ensureLinkTables();
    const sql = await getSql();
    await sql`delete from oauth_states where advisor_id = ${gate.row.id} and provider = ${provider}`;
    await sql`
      insert into oauth_states (state, advisor_id, slug, verifier, redirect_uri, display_name, provider)
      values (${state}, ${gate.row.id}, ${gate.row.slug}, ${verifier}, ${redirectUri}, ${""}, ${provider})
    `;
    return { ok: true as const, url: linkAuthorizeUrl({ provider, clientId: config.clientId, redirectUri, state, challenge }) };
  });

export const loadAdvisorZone = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    return { ok: true as const, timeZone: await advisorZone(gate.row.id) };
  });

export const saveTimeZone = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; timeZone: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    return { ok: true as const, timeZone: await saveAdvisorZone(gate.row.id, data.timeZone) };
  });

export const loadFileStore = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    return { ok: true as const, ...(await fileSettings(gate.row.id)) };
  });

export const saveFileStore = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; saveRecordings?: boolean; store?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    return { ok: true as const, ...(await saveFileSettings(gate.row.id, data)) };
  });

export const loadDeskNotices = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    return { ok: true as const, notices: await listDeskNotices(gate.row.id) };
  });

export const dismissDeskNotices = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    await clearDeskNotices(gate.row.id);
    return { ok: true as const };
  });

export const disconnectConnection = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; provider: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    if (data.provider !== "test_calendar" && !isLinkProvider(data.provider)) return { ok: false as const, error: "That connection is not available." };
    await disconnectAdvisorLink(gate.row.id, data.provider);
    return { ok: true as const };
  });

export const loadUpcomingMeetings = createServerFn({ method: "POST" })
  .validator((input: { slug?: string; code?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug || "", data.code || "");
    if (!gate.ok) return gate;
    const listed = await listUpcomingMeetings(gate.row.id);
    return { ok: true as const, ...listed };
  });

export const cancelAdvisorMeeting = createServerFn({ method: "POST" })
  .validator((input: { slug?: string; code?: string; meetingId?: string; eventId?: number; notify?: boolean }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug || "", data.code || "");
    if (!gate.ok) return gate;
    return cancelBookedMeeting(gate.row.id, { meetingId: String(data.meetingId || ""), eventId: Number(data.eventId) || 0, notify: data.notify !== false });
  });

export const loadAdvisorCalendar = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; year: number; month: number }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const year = Number(data.year);
    const month = Number(data.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) return { ok: false as const, error: "Choose a month." };
    const loaded = await loadDeskCalendar(gate.row.id, year, month);
    return { ok: true as const, ...loaded };
  });

export const syncAdvisorCalendar = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; source: string; year: number; month: number }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const source = data.source === "google" || data.source === "outlook" || data.source === "icloud" ? data.source : "";
    if (!source) return { ok: false as const, error: "Choose Outlook, Google, or iCloud." };
    return syncDeskCalendar(gate.row.id, source, Number(data.year), Number(data.month));
  });

export const saveAdvisorCalendarEvent = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; title: string; start: string; minutes: number; source: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const source = data.source === "google" || data.source === "outlook" || data.source === "icloud" || data.source === "desk" ? data.source : "desk";
    return addDeskCalendarEvent(gate.row.id, { title: data.title, start: data.start, minutes: Number(data.minutes), source });
  });

export const connectIcloud = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; username: string; password: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    return connectIcloudCalendar(gate.row.id, data.username, data.password);
  });
