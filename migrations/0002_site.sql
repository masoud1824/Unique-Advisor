create table if not exists site_settings (
  id integer primary key,
  palette text not null default 'ink',
  show_life boolean not null default true,
  show_critical boolean not null default true,
  show_disability boolean not null default true,
  show_group boolean not null default true,
  show_facts boolean not null default true,
  show_form boolean not null default true,
  code_hash text,
  code_is_default boolean not null default true,
  constraint site_settings_singleton check (id = 1)
);

create table if not exists leads (
  id serial primary key,
  full_name text not null,
  email text not null,
  phone text not null default '',
  interest text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists leads_created_at_idx on leads (created_at desc);
