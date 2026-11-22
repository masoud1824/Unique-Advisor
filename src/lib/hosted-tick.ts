import { runHostedDispatch } from "./hosted-dispatch.ts";
import { buildHostedProviders, productionAdvisorSecrets, providerExecutionGate, type AdvisorSecrets } from "./hosted-providers.ts";
import { budgetOpen, cronAuthorized, hostedDataPlane, redactPrivate } from "./hosted-runtime.ts";
import type { QuerySql } from "./library-store.ts";
import { outboundBlocked } from "./outbound-guard.ts";

export async function handleJobTick(request: Request, deps?: {
  now?: Date;
  sql?: QuerySql;
  fetchImpl?: typeof fetch;
  secrets?: AdvisorSecrets;
}): Promise<Response> {
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (hostedDataPlane() && !process.env.DATABASE_URL?.trim() && !deps?.sql) {
    return Response.json({ ok: false, error: "Database is not configured." }, { status: 503 });
  }
  const now = deps?.now ?? new Date();
  const gate = providerExecutionGate(process.env);
  const blocked = outboundBlocked() || !gate.attach;
  const budgetClosed = !budgetOpen("mail") || !budgetOpen("signature");
  try {
    const sql = deps?.sql ?? await (await import("./db.ts")).getSql();
    const providers = gate.attach
      ? buildHostedProviders({ secrets: deps?.secrets ?? productionAdvisorSecrets(), fetchImpl: deps?.fetchImpl })
      : undefined;
    const result = await runHostedDispatch(sql, { now, outboundBlocked: blocked, providers });
    const detail = !gate.attach
      ? gate.reason
      : budgetClosed
        ? "A budget switch is on. Nothing was sent."
        : "Authorized advisor jobs were handed to the configured provider. Missing connections were blocked and were not reported as sent.";
    await sql.query(
      `insert into hosted_job_runs (run_key, kind, slot, status, detail)
       values ($1, 'tick', $2, 'dispatched', $3)
       on conflict (run_key) do nothing`,
      [`tick:${now.toISOString().slice(0, 16)}`, now.toISOString().slice(0, 16), redactPrivate(detail).slice(0, 500)],
    );
    return Response.json({
      ok: true,
      blocked,
      execute: gate.attach,
      sent: blocked || budgetClosed ? 0 : result.sent,
      birthdays: blocked || budgetClosed ? 0 : result.birthdays.providerCalls,
      drips: blocked || budgetClosed ? 0 : result.drips.advanced,
      replies: blocked || budgetClosed ? 0 : result.replies.stored,
      signaturesFiled: blocked || budgetClosed ? 0 : result.signatures.filed,
      detail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "tick failed";
    console.info(`[jobs] ${redactPrivate(message)}`);
    return Response.json({ ok: false, error: "Job dispatch failed. Nothing was sent." }, { status: 500 });
  }
}
