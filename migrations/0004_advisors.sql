create table if not exists operators (
  id integer primary key,
  code_hash text,
  code_is_default boolean not null default true,
  constraint operators_singleton check (id = 1)
);

create table if not exists advisors (
  id serial primary key,
  slug text not null unique,
  practice_name text not null,
  advisor_name text not null,
  email text not null default '',
  plan text not null default 'starter',
  status text not null default 'active',
  package text not null default 'explain',
  palette text not null default 'ink',
  show_life boolean not null default true,
  show_critical boolean not null default true,
  show_disability boolean not null default true,
  show_group boolean not null default true,
  show_facts boolean not null default true,
  show_form boolean not null default true,
  code_hash text,
  code_is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists advisors_email_idx on advisors (lower(email));

alter table leads add column if not exists advisor_id integer references advisors(id) on delete cascade;

create index if not exists leads_advisor_created_idx on leads (advisor_id, created_at desc);

create table if not exists contacts (
  id serial primary key,
  advisor_id integer not null references advisors(id) on delete cascade,
  full_name text not null,
  email text not null default '',
  phone text not null default '',
  tags text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists contacts_advisor_idx on contacts (advisor_id, created_at desc);

create table if not exists saved_cards (
  id serial primary key,
  advisor_id integer not null references advisors(id) on delete cascade,
  title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists saved_letters (
  id serial primary key,
  advisor_id integer not null references advisors(id) on delete cascade,
  title text not null,
  subject text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id serial primary key,
  advisor_id integer not null references advisors(id) on delete cascade,
  kind text not null,
  title text not null,
  subject text not null default '',
  body text not null,
  contact_name text not null,
  contact_email text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists messages_advisor_idx on messages (advisor_id, created_at desc);
