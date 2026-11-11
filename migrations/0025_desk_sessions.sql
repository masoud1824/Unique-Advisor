create table if not exists desk_sessions (
  token_hash text primary key,
  advisor_id integer not null,
  slug text not null,
  code_hash text not null,
  expires_at timestamptz not null
);

create index if not exists desk_sessions_advisor_idx on desk_sessions (advisor_id);

create table if not exists desk_session_secret (
  id integer primary key,
  secret text not null
);
