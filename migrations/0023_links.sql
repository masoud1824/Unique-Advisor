create table if not exists link_apps (
  provider text primary key,
  client_id text not null default '',
  client_secret text not null default ''
);

create table if not exists advisor_links (
  advisor_id integer not null references advisors(id) on delete cascade,
  provider text not null,
  account_label text not null default '',
  refresh_token text not null default '',
  access_token text not null default '',
  expires_at bigint not null default 0,
  primary key (advisor_id, provider)
);

create table if not exists assistant_actions (
  id serial primary key,
  advisor_id integer not null references advisors(id) on delete cascade,
  kind text not null,
  summary text not null,
  payload text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table oauth_states add column if not exists provider text not null default 'microsoft';
