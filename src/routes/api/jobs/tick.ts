import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { runHostedDispatch } from "@/lib/hosted-dispatch";
import { cronAuthorized, budgetOpen, hostedDataPlane, redactPrivate } from "@/lib/hosted-runtime";
import { outboundBlocked } from "@/lib/outbound-guard";

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
        const blocked = outboundBlocked();
        const budgetClosed = !budgetOpen("mail") || !budgetOpen("signature");
        try {
          const sql = await getSql();
          const result = await runHostedDispatch(sql, { now, outboundBlocked: blocked });
          await sql.query(
            `insert into hosted_job_runs (run_key, kind, slot, status, detail)
             values ($1, 'tick', $2, 'dispatched', $3)
             on conflict (run_key) do nothing`,
            [`tick:${now.toISOString().slice(0, 16)}`, now.toISOString().slice(0, 16), blocked ? "outbound blocked" : "providers not configured for live network"],
          );
          return Response.json({
            ok: true,
            blocked,
            sent: blocked || budgetClosed ? 0 : result.sent,
            birthdays: result.birthdays.providerCalls,
            drips: result.drips.advanced,
            replies: result.replies.stored,
            signaturesFiled: result.signatures.filed,
            detail: blocked
              ? "Jobs were claimed and stopped at the provider boundary. Nothing was sent."
              : budgetClosed
                ? "A budget switch is on. Nothing was sent."
                : "No live mailbox or signature provider is attached by this route. Nothing was sent.",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "tick failed";
          console.info(`[jobs] ${redactPrivate(message)}`);
          return Response.json({ ok: false, error: "Job dispatch failed. Nothing was sent." }, { status: 500 });
        }
      },
    },
  },
});
