import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import test from "node:test";
import type { Sql } from "./db.ts";
import { DESK_BOOKING_LIMIT, keepsAppointmentOnDesk, saveDeskAppointment } from "./desk-appointment.ts";

const READ_ONLY = "This preview is read-only. Nothing was created, changed, deleted, sent, or booked.";

function asSql(pg: PGlite): Sql {
  const run = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows;
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((part, index) => {
      text += part;
      if (index < values.length) text += `$${index + 1}`;
    });
    return run(text, values);
  }) as Sql;
  sql.query = run;
  return sql;
}

test("a confirmed appointment is saved on the desk, including a preview database", async () => {
  assert.equal(keepsAppointmentOnDesk("pglite", false), true);
  assert.equal(keepsAppointmentOnDesk("pglite", true), true);
  assert.equal(keepsAppointmentOnDesk("neon", true), true);
  assert.equal(keepsAppointmentOnDesk("neon", false), false);

  const pg = new PGlite();
  const sql = asSql(pg);
  await sql.query(`create table desk_calendar_events (
    id serial primary key,
    advisor_id integer not null,
    source text not null,
    title text not null,
    start_at timestamptz not null,
    minutes integer not null default 30
  )`);
  const input = {
    advisorId: 7,
    title: "Zoom meeting with Morgan Sample",
    startIso: "2026-11-28T15:00:00.000Z",
    minutes: 30,
    label: "Saturday, Nov 28 at 10:00 AM Toronto time",
  };
  const saved = await saveDeskAppointment(sql, input);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.message.includes(READ_ONLY), false);
  assert.match(saved.message, /^Booked on this desk: Zoom meeting with Morgan Sample on Saturday, Nov 28 at 10:00 AM Toronto time\./);
  assert.match(saved.message, new RegExp(DESK_BOOKING_LIMIT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const rows = await sql<{ source: string; title: string; minutes: number }>`
    select source, title, minutes from desk_calendar_events where advisor_id = ${7}
  `;
  assert.deepEqual(rows, [{ source: "Desk", title: input.title, minutes: 30 }]);
  const again = await saveDeskAppointment(sql, input);
  assert.equal(again.ok && again.already, true);
  assert.match(again.ok ? again.message : "", /^Already on this desk:/);
  const after = await sql<{ id: number }>`select id from desk_calendar_events where advisor_id = ${7}`;
  assert.equal(after.length, 1);
  await pg.close();
});
