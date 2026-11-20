create table if not exists birthday_settings (
  advisor_id integer primary key references advisors(id) on delete cascade,
  enabled boolean not null default false,
  source text not null default '',
  timezone text not null default 'America/Toronto',
  feb29 text not null default 'skip',
  card_title text not null default '',
  template_version integer not null default 1,
  confirmed_version integer not null default 0,
  last_run_date text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists birthday_claims (
  claim_key text primary key,
  advisor_id integer not null,
  contact_id text not null,
  occasion_year text not null,
  status text not null,
  provider_id text not null default '',
  detail text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists birthday_notices (
  id serial primary key,
  advisor_id integer not null,
  run_date text not null,
  body text not null,
  created_at timestamptz not null default now()
);
