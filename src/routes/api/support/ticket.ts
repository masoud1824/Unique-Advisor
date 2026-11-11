import { createFileRoute } from "@tanstack/react-router";
import { findTicketByNumber, readAnyTicket, staffNote, staffReply, staffUpdate, supportKeyMatches } from "@/lib/support";

async function allowed(request: Request) {
  return supportKeyMatches(request.headers.get("authorization") || "");
}

async function ticketId(request: Request, body?: { id?: number; number?: string }) {
  const url = new URL(request.url);
  const fromQuery = Number(url.searchParams.get("id") || body?.id || 0);
  if (fromQuery > 0) return fromQuery;
  const number = url.searchParams.get("number") || body?.number || "";
  return number ? findTicketByNumber(number) : 0;
}

export const Route = createFileRoute("/api/support/ticket")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await allowed(request))) return Response.json({ error: "The support API key was not accepted." }, { status: 401 });
        const result = await readAnyTicket(await ticketId(request));
        if (!result.ok) return Response.json({ error: result.error }, { status: 404 });
        return Response.json(result);
      },
      POST: async ({ request }) => {
        if (!(await allowed(request))) return Response.json({ error: "The support API key was not accepted." }, { status: 401 });
        const body = (await request.json().catch(() => ({}))) as { action?: string; id?: number; number?: string; body?: string; status?: string; priority?: string; assignee?: string };
        const id = await ticketId(request, body);
        const action = String(body.action || "");
        const result = action === "reply"
          ? await staffReply(id, String(body.body || ""))
          : action === "note"
            ? await staffNote(id, String(body.body || ""))
            : action === "update"
              ? await staffUpdate(id, body)
              : { ok: false as const, error: "Use action reply, note, or update." };
        if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
        return Response.json(await readAnyTicket(id));
      },
    },
  },
});
