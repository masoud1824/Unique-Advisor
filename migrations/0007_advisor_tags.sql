create table if not exists platform_tags (
  id serial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists advisor_tags (
  id serial primary key,
  advisor_id integer not null references advisors(id) on delete cascade,
  name text not null,
  source text not null default 'own',
  created_at timestamptz not null default now(),
  unique (advisor_id, name)
);

create index if not exists advisor_tags_advisor_idx on advisor_tags (advisor_id);
