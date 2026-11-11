import { getSql } from "@/lib/db";
import { cleanVoiceEvents, type VoiceLogEvent } from "@/lib/voice-log-events";

export type { VoiceLogEvent } from "@/lib/voice-log-events";
export { cleanVoiceEvents } from "@/lib/voice-log-events";

export async function ensureVoiceLogs() {
  const sql = await getSql();
  await sql.query(`create table if not exists voice_logs (
    id serial primary key,
    advisor_id integer not null,
    session_key text not null,
    events jsonb not null default '[]'::jsonb,
    sent_text text not null default '',
    created_at timestamptz not null default now(),
    unique (advisor_id, session_key)
  )`);
  await sql.query("create index if not exists voice_logs_advisor_idx on voice_logs (advisor_id, id desc)");
}

export async function appendVoiceSession(advisorId: number, sessionKey: string, events: VoiceLogEvent[], sentText: string) {
  const key = sessionKey.replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  if (!key) return;
  await ensureVoiceLogs();
  const sql = await getSql();
  const payload = JSON.stringify(events);
  const sent = sentText.replace(/\s+/g, " ").trim().slice(0, 2000);
  await sql.query(
    `insert into voice_logs (advisor_id, session_key, events, sent_text)
     values ($1, $2, $3::jsonb, $4)
     on conflict (advisor_id, session_key)
     do update set
       events = voice_logs.events || excluded.events,
       sent_text = case when excluded.sent_text <> '' then excluded.sent_text else voice_logs.sent_text end`,
    [advisorId, key, payload, sent],
  );
  await sql.query(
    `delete from voice_logs
     where advisor_id = $1
       and id not in (select id from voice_logs where advisor_id = $1 order by id desc limit 20)`,
    [advisorId],
  );
}

function readEvents(value: unknown): VoiceLogEvent[] {
  if (typeof value === "string") {
    try { return cleanVoiceEvents(JSON.parse(value)); } catch { return []; }
  }
  return cleanVoiceEvents(value);
}

export async function listVoiceSessions(advisorId: number) {
  await ensureVoiceLogs();
  const sql = await getSql();
  const rows = await sql.query<{ id: number; session_key: string; events: unknown; sent_text: string; created_at: string }>(
    "select id, session_key, events, sent_text, created_at from voice_logs where advisor_id = $1 order by id desc limit 20",
    [advisorId],
  );
  return rows.map((row) => ({
    id: row.id,
    sessionKey: row.session_key,
    sentText: row.sent_text || "",
    createdAt: row.created_at,
    events: readEvents(row.events),
  }));
}

export async function listVoiceAdvisors() {
  await ensureVoiceLogs();
  const sql = await getSql();
  return sql.query<{ id: number; name: string; slug: string }>(
    "select id, advisor_name as name, slug from advisors order by advisor_name, slug",
  );
}
