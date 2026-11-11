alter table site_settings
  add column if not exists package text not null default 'explain';

create table if not exists lead_steps (
  id serial primary key,
  lead_id integer not null references leads(id) on delete cascade,
  step_key text not null,
  title text not null,
  detail text not null,
  due_on date not null,
  done boolean not null default false
);

create index if not exists lead_steps_lead_id_idx on lead_steps (lead_id);
