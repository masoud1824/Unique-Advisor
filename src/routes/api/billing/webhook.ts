import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { applyPaymentEvent, paymentConfigured, signatureMatches, withBilling, type PaymentEvent } from "@/lib/billing/usage";

export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!paymentConfigured()) {
          return Response.json({ ok: false, credited: false, error: "No payment provider is configured. No balance was added." }, { status: 404 });
        }
        const raw = await request.text();
        if (!signatureMatches(raw, request.headers.get("x-ua-test-signature") || "")) {
          return Response.json({ ok: false, credited: false, error: "The payment signature did not match. No balance was added." }, { status: 401 });
        }
        const event = JSON.parse(raw) as PaymentEvent;
        if (!event?.id || !event.purchaseId || !event.advisorId || !event.type) {
          return Response.json({ ok: false, credited: false, error: "The payment event was incomplete. No balance was added." }, { status: 400 });
        }
        const sql = await getSql();
        const rows = await sql.query<{ advisor_id: string }>(
          "select advisor_id from advisor_billing_state where purchases @> $1::jsonb",
          [JSON.stringify([{ id: event.purchaseId }])],
        );
        const advisorId = String(rows[0]?.advisor_id || "");
        if (!advisorId || advisorId !== event.advisorId) {
          return Response.json({ ok: false, credited: false, error: "That payment does not belong to this advisor. No balance was added." }, { status: 403 });
        }
        const result = await withBilling(sql, advisorId, new Date(), (state) => applyPaymentEvent({
          purchases: state.purchases,
          events: state.events,
          account: state.ledger.account,
          event,
          now: new Date(),
        }));
        return Response.json({ ok: result.ok, credited: result.credited === true, duplicate: "duplicate" in result ? result.duplicate : false });
      },
    },
  },
});
