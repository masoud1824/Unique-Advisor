alter table contacts add column if not exists birthday text not null default '';
alter table contacts add column if not exists products text not null default '';
alter table contacts add column if not exists product_note text not null default '';
alter table contacts add column if not exists kyc_on text not null default '';

create table if not exists contact_logs (
  id serial primary key,
  advisor_id integer not null,
  contact_id integer not null,
  kind text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists contact_logs_advisor_idx on contact_logs (advisor_id, contact_id, created_at desc);
