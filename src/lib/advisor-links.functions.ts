import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { gateAdvisor, gateOperator } from "@/lib/advisor-db";
import {
  createLinkAuthorization,
  disconnectAdvisorLink,
  ensureLinkTables,
  isLinkProvider,
  linkAppStatus,
  listAdvisorLinkRows,
  saveLinkApp,
  saveAdvisorZoom,
  signInAdvisorPassword,
  loadDeskCalendar,
  syncDeskCalendar,
  addDeskCalendarEvent,
  connectIcloudCalendar,
} from "@/lib/advisor-links";
import { beginZoomSignIn } from "@/lib/zoom-oauth";
import { listSignatureNotices, markSignatureNoticesRead as markSignatureHistoryRead } from "@/lib/signature-notice-store";
import { checkAdvisorSignatures, retrySignatureFiling, startSignatureWatch } from "@/lib/signature-watch";
import { SIGNATURE_TEST } from "@/lib/signature-test-preview";
import { fileSettings, listDeskNotices, listUpcomingMeetings, clearDeskNotices, saveFileSettings, advisorZone, saveAdvisorZone, cancelBookedMeeting } from "@/lib/zoom-bookings";
import { previewWritesBlocked } from "@/lib/preview-readonly";
import { externalSideEffectsBlocked, ISOLATED_EXTERNAL_BLOCK } from "@/lib/isolated-test-desk";
import { readConnectedPreview, type ProviderReadKind } from "@/lib/provider-read.ts";
import { getSql } from "@/lib/db";

export const loadLinkApps = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code);
    if (!gate.ok) return gate;
    return { ok: true as const, apps: await linkAppStatus() };
  });

export const saveConnectionApp = createServerFn({ method: "POST" })
  .validator((input: { code: string; provider: string; clientId: string; clientSecret: string; apiKey?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code);
    if (!gate.ok) return gate;
    if (!isLinkProvider(data.provider) || data.provider === "outlook_calendar") {
      return { ok: false as const, error: "Outlook Calendar uses the Microsoft app already saved under Settings." };
    }
    const clientId = data.clientId.trim();
    const clientSecret = data.clientSecret.trim();
    const apiKey = String(data.apiKey || "").trim();
    if (clientId.length < 6 || clientSecret.length < 6) return { ok: false as const, error: "Paste both the app ID and the secret." };
    if (data.provider === "dropbox_sign" && apiKey.length < 6) return { ok: false as const, error: "Dropbox Sign also needs the API key, used only to verify callbacks." };
    try {
      await saveLinkApp(data.provider, clientId, clientSecret, apiKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dropbox Sign could not be saved.";
      return { ok: false as const, error: message.slice(0, 180) };
    }
    return { ok: true as const, apps: await linkAppStatus() };
  });

export const saveTestSigners = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; emails: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const emails = String(data.emails || "").split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
    if (!emails.length) return { ok: false as const, error: "Enter at least one test email address." };
    const sql = await getSql();
    await sql.query(`create table if not exists signature_test_signers (
      advisor_id integer primary key references advisors(id) on delete cascade,
      emails text not null default ''
    )`);
    await sql`
      insert into signature_test_signers (advisor_id, emails)
      values (${gate.row.id}, ${emails.join(", ")})
      on conflict (advisor_id) do update set emails = excluded.emails
    `;
    return { ok: true as const, count: emails.length };
  });

export const listConnectionStatus = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    startSignatureWatch();
    const { checkDocumentReplies, startDocumentMailWatch } = await import("@/lib/document-mail-live");
    startDocumentMailWatch();
    await checkDocumentReplies(gate.row.id).catch(() => undefined);
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

export const previewConnectedRead = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; kind: ProviderReadKind }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    if (data.kind !== "inbox" && data.kind !== "dropbox" && data.kind !== "zoom") {
      return { ok: false as const, error: "That read is not available." };
    }
    return { ok: true as const, text: await readConnectedPreview(gate.row.id, data.kind) };
  });

export const checkSignatureStatus = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    return checkAdvisorSignatures(gate.row.id);
  });

export const loadSignatureTest = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    if (gate.row.slug !== SIGNATURE_TEST.advisorSlug) return { ok: true as const, sent: false as const };
    const { getSql } = await import("@/lib/db");
    const { ensureSignatureRequests } = await import("@/lib/signature-watch");
    await ensureSignatureRequests();
    const rows = await (await getSql())<{ request_id: string; status: string }>`
      select request_id, status from signature_requests
      where advisor_id = ${gate.row.id} and document_id = ${SIGNATURE_TEST.documentId}
      limit 1
    `;
    if (!rows[0]) return { ok: true as const, sent: false as const };
    return { ok: true as const, sent: true as const, requestId: rows[0].request_id, status: rows[0].status };
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
    try {
      return await createLinkAuthorization({
        advisorId: gate.row.id,
        slug: gate.row.slug,
        provider: data.provider,
        redirectUri: data.redirectUri,
        request: getRequest(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign-in could not be started.";
      return { ok: false as const, error: message };
    }
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

export const loadSignatureNotices = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const notices = await listSignatureNotices(gate.row.id);
    return { ok: true as const, unread: notices.filter((notice) => notice.unread).length, notices };
  });

export const markSignatureNoticesRead = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    await markSignatureHistoryRead(gate.row.id);
    return { ok: true as const };
  });

export const retrySignatureNotice = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; requestId: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const result = await retrySignatureFiling(gate.row.id, String(data.requestId || ""));
    if (!result.ok) return result;
    const notices = await listSignatureNotices(gate.row.id);
    return { ...result, unread: notices.filter((notice) => notice.unread).length, notices };
  });

export const disconnectConnection = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; provider: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    if (data.provider !== "test_calendar" && !isLinkProvider(data.provider)) return { ok: false as const, error: "That connection is not available." };
    if (data.provider !== "test_calendar" && (previewWritesBlocked() || externalSideEffectsBlocked())) return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK };
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
