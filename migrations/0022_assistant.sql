alter table operators add column if not exists assistant_json text not null default '';

create table if not exists assistant_drafts (
  id serial primary key,
  advisor_id integer not null references advisors(id) on delete cascade,
  to_email text not null,
  to_name text not null default '',
  subject text not null,
  body text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists assistant_drafts_advisor_idx on assistant_drafts (advisor_id, created_at desc);
