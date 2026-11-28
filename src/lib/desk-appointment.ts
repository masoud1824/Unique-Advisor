import type { Sql } from "@/lib/db";

export const DESK_BOOKING_LIMIT =
  "Zoom was not created and no invitation was sent, because this staging desk does not call Zoom or send mail.";

/** A confirmed appointment stays on the desk when Zoom and mail cannot be called. */
export function keepsAppointmentOnDesk(database: "neon" | "pglite", externalBlocked: boolean) {
  return externalBlocked || database === "pglite";
}

export async function saveDeskAppointment(
  sql: Sql,
  input: { advisorId: number; title: string; startIso: string; minutes: number; label: string },
) {
  const start = new Date(input.startIso);
  if (!input.startIso || Number.isNaN(start.getTime())) {
    return { ok: false as const, booked: false as const, error: "The appointment has no date. Nothing was booked." };
  }
  const title = input.title.trim() || "Meeting";
  const when = start.toISOString();
  const same = await sql<{ id: number }>`
    select id from desk_calendar_events
    where advisor_id = ${input.advisorId} and title = ${title} and start_at = ${when}
    limit 1
  `;
  if (same[0]) {
    return {
      ok: true as const,
      booked: true as const,
      join: "",
      already: true,
      message: `Already on this desk: ${title} on ${input.label}. I did not book it again. ${DESK_BOOKING_LIMIT}`,
    };
  }
  await sql`
    insert into desk_calendar_events (advisor_id, source, title, start_at, minutes)
    values (${input.advisorId}, ${"Desk"}, ${title}, ${when}, ${input.minutes || 30})
  `;
  return {
    ok: true as const,
    booked: true as const,
    join: "",
    already: false,
    message: `Booked on this desk: ${title} on ${input.label}. ${DESK_BOOKING_LIMIT}`,
  };
}
