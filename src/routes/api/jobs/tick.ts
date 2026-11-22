import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { advisorBirthdayWindow, dripDue, tickDecision, tickRunKey, tickSlot } from "@/lib/hosted-jobs";
import { cronAuthorized, hostedDataPlane, redactPrivate } from "@/lib/hosted-runtime";
import { outboundBlocked } from "@/lib/outbound-guard";

async function countDue(now: Date) {
  const sql = await getSql();
  const settings = await sql.query<{ advisor_id: number; timezone: string; last_run_date: string; enabled: boolean | string }>(
    "select advisor_id, timezone, last_run_date, enabled from birthday_settings order by advisor_id",
  ).catch(() => []);
  const birthdays = settings.filter((row) => {
    const enabled = row.enabled === true || row.enabled === "t" || row.enabled === "true";
    if (!enabled) return false;
    return advisorBirthdayWindow(now, String(row.timezone || ""), String(row.last_run_date || "")).window === "run";
  }).length;
  const drips = await sql.query<{ active: boolean | string; next_at: string | null }>(
    "select active, next_at from drip_campaigns",
  ).catch(() => []);
  const dueDrips = drips.filter((row) => dripDue({
    active: row.active === true || row.active === "t" || row.active === "true",
    nextAt: row.next_at ? new Date(row.next_at).toISOString() : null,
    nowMs: now.getTime(),
  })).length;
  const signatures = await sql.query<{ n: number }>(
    "select count(*)::int as n from signature_requests where next_check_at <= $1 and status not in ('declined', 'expired', 'failed')",
    [now.getTime()],
  ).catch(() => [{ n: 0 }]);
  return { birthdays, dueDrips, signatureDue: Number(signatures[0]?.n || 0) };
}

export const Route = createFileRoute("/api/jobs/tick")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!cronAuthorized(request.headers.get("authorization"))) {
          return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
        }
        if (hostedDataPlane() && !process.env.DATABASE_URL?.trim()) {
          return Response.json({ ok: false, error: "Database is not configured." }, { status: 503 });
        }
        const now = new Date();
        const slot = tickSlot(now);
        const runKey = tickRunKey(slot);
        try {
          const sql = await getSql();
          const inserted = await sql.query<{ run_key: string }>(
            `insert into hosted_job_runs (run_key, kind, slot, status, detail)
             values ($1, 'tick', $2, 'started', '')
             on conflict (run_key) do nothing
             returning run_key`,
            [runKey, slot],
          );
          const decision = tickDecision({
            outboundBlocked: outboundBlocked(),
            executeRequested: process.env.UA_JOBS_EXECUTE === "1",
            duplicate: inserted.length === 0,
          });
          const due = inserted.length ? await countDue(now) : { birthdays: 0, dueDrips: 0, signatureDue: 0 };
          if (inserted.length) {
            await sql.query(
              "update hosted_job_runs set status = $2, detail = $3 where run_key = $1",
              [runKey, decision.status, decision.detail.slice(0, 500)],
            );
          }
          return Response.json({
            ok: true,
            status: decision.status,
            sent: 0,
            due,
            detail: decision.detail,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "tick failed";
          console.info(`[jobs] ${redactPrivate(message)}`);
          return Response.json({ ok: false, error: "Job record was not written. Nothing was sent." }, { status: 500 });
        }
      },
    },
  },
});
