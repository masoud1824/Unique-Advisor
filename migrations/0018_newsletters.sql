create table if not exists newsletters (
  id serial primary key,
  advisor_id integer not null references advisors(id) on delete cascade,
  token text not null unique,
  payload text not null,
  logo_data text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists newsletters_advisor_idx on newsletters (advisor_id, created_at desc);
