create table if not exists promotions (
  id serial primary key,
  code text not null unique,
  kind text not null default 'percent',
  amount integer not null,
  note text not null default '',
  active boolean not null default true,
  max_uses integer not null default 0,
  used_count integer not null default 0,
  expires_on date,
  created_at timestamptz not null default now()
);

alter table advisors add column if not exists promo_code text not null default '';
alter table advisors add column if not exists promo_kind text not null default '';
alter table advisors add column if not exists promo_amount integer not null default 0;
