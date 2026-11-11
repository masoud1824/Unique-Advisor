create table if not exists platform_templates (
  id serial primary key,
  kind text not null,
  name text not null,
  detail text not null default '',
  body text not null default '',
  created_at timestamptz not null default now()
);
