create table if not exists desk_announcements (
  id serial primary key,
  status text not null default 'draft',
  title text not null,
  body text not null default '',
  link text not null default '',
  priority integer not null default 100,
  language text not null default 'en',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
