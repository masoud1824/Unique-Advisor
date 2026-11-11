create table if not exists voice_logs (
  id serial primary key,
  advisor_id integer not null,
  session_key text not null,
  events jsonb not null default '[]'::jsonb,
  sent_text text not null default '',
  created_at timestamptz not null default now(),
  unique (advisor_id, session_key)
);

create index if not exists voice_logs_advisor_idx on voice_logs (advisor_id, id desc);
