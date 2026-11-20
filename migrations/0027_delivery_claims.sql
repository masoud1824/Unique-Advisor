create table if not exists delivery_claims (
  advisor_id integer not null,
  fingerprint text not null,
  kind text not null default '',
  created_at timestamptz not null default now(),
  primary key (advisor_id, fingerprint)
);
