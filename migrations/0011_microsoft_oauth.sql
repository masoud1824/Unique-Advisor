alter table advisors add column if not exists mail_provider text not null default '';
alter table advisors add column if not exists ms_refresh text not null default '';
alter table advisors add column if not exists ms_access text not null default '';
alter table advisors add column if not exists ms_expires bigint not null default 0;

create table if not exists oauth_states (
  state text primary key,
  advisor_id integer not null,
  slug text not null,
  verifier text not null,
  redirect_uri text not null,
  display_name text not null default '',
  created_at timestamptz not null default now()
);
