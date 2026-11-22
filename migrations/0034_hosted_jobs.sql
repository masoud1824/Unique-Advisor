-- Durable job bookkeeping for a hosted Postgres database.
-- Safe to re-run. Does not copy or alter an existing production database by itself.

create table if not exists hosted_job_runs (
  run_key text primary key,
  kind text not null,
  slot text not null,
  status text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists drip_campaigns (
  id bigserial primary key,
  advisor_id integer not null,
  name text not null,
  tag text not null default '',
  steps text not null default '[]',
  every_days integer not null default 7,
  active boolean not null default false,
  next_index integer not null default 0,
  next_at timestamptz,
  contact_ids text not null default '[]',
  design text not null default 'plum',
  created_at timestamptz not null default now()
);

create table if not exists signature_requests (
  advisor_id integer not null,
  request_id text not null,
  document_id text not null default '',
  version text not null default '',
  fingerprint text not null default '',
  folder text not null default '',
  storage text not null default 'dropbox',
  status text not null default 'sent',
  filed_signed text not null default '',
  filed_audit text not null default '',
  attempts integer not null default 0,
  next_check_at bigint not null default 0,
  last_error text not null default '',
  signature_provider text not null default 'dropbox_sign',
  primary key (advisor_id, request_id)
);

create table if not exists signature_events (
  advisor_id text not null,
  request_id text not null,
  event_hash text not null,
  status text not null,
  primary key (advisor_id, request_id, event_hash)
);
