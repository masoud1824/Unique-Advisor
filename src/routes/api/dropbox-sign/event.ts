import { createFileRoute } from "@tanstack/react-router";
import { eventIsAuthentic, parseCallbackBody, statusFromEvent, CALLBACK_ACK } from "@/lib/dropbox-sign";
import { getSql } from "@/lib/db";
import { openSecret } from "@/lib/microsoft-mail";
import { rememberSignatureOutcome } from "@/lib/signature-notice-store";

export const Route = createFileRoute("/api/dropbox-sign/event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") || "";
        let rawBody = "";
        let formJson: string | null = null;
        if (contentType.includes("application/json")) {
          rawBody = await request.text();
        } else {
          const form = await request.formData().catch(() => null);
          const field = form?.get("json");
          formJson = typeof field === "string" ? field : null;
        }
        const body = parseCallbackBody(contentType, rawBody, formJson);
        const event = body?.event || {};
        const sql = await getSql();
        await sql.query(`create table if not exists link_apps (
          provider text primary key,
          client_id text not null default '',
          client_secret text not null default '',
          api_key text not null default ''
        )`);
        await sql.query("alter table link_apps add column if not exists api_key text not null default ''");
        const saved = await sql<{ api_key: string }>`select api_key from link_apps where provider = 'dropbox_sign'`;
        const apiKey = saved[0]?.api_key ? await openSecret(saved[0].api_key) : "";
        const eventType = String(event.event_type || "");
        const eventTime = String(event.event_time || "");
        const eventHash = String(event.event_hash || "");
        if (!apiKey || !eventIsAuthentic(apiKey, eventTime, eventType, eventHash)) {
          return new Response("Callback was not verified.", { status: 401 });
        }
        const requestId = String(body?.signature_request?.signature_request_id || "");
        const advisorId = String(body?.signature_request?.metadata?.advisor_id || "");
        const allSigned = Boolean(body?.signature_request?.is_complete) || eventType === "signature_request_all_signed";
        const status = statusFromEvent(eventType, allSigned);
        if (requestId && advisorId && status) {
          await sql.query(`create table if not exists signature_events (
            advisor_id text not null,
            request_id text not null,
            event_hash text not null,
            status text not null,
            primary key (advisor_id, request_id, event_hash)
          )`);
          await sql`
            insert into signature_events (advisor_id, request_id, event_hash, status)
            values (${advisorId}, ${requestId}, ${eventHash}, ${status})
            on conflict (advisor_id, request_id, event_hash) do nothing
          `;
          const owner = Number(advisorId);
          if (allSigned && owner > 0) {
            const row = (await sql<{ document_id: string; folder: string; filed_signed: string; filed_audit: string }>`
              select document_id, folder, filed_signed, filed_audit from signature_requests
              where advisor_id = ${owner} and request_id = ${requestId} limit 1
            `)[0];
            if (row) {
              await rememberSignatureOutcome(owner, requestId, {
                documentId: row.document_id,
                folder: row.folder,
                completed: true,
                filedSigned: String(row.filed_signed || "").startsWith("/"),
                filedAudit: String(row.filed_audit || "").startsWith("/"),
                filingFailed: false,
                signedPath: String(row.filed_signed || ""),
                auditPath: String(row.filed_audit || "").startsWith("/") ? row.filed_audit : "",
              });
            }
          }
        }
        return new Response(CALLBACK_ACK, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
      },
    },
  },
});
