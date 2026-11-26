-- Isolated agent-preview state. New tables only. Does not alter clients, contacts, or mail.

create table if not exists agent_preview_runs (
  id text primary key,
  advisor_id integer not null,
  slug text not null default '',
  status text not null default 'open',
  messages jsonb not null default '[]'::jsonb,
  facts jsonb not null default '{}'::jsonb,
  pending jsonb,
  consumed_hashes jsonb not null default '[]'::jsonb,
  stale_hashes jsonb not null default '[]'::jsonb,
  approval_status text not null default '',
  serialized text not null default '',
  pdf bytea,
  template_pdf bytea,
  tool_trace jsonb not null default '[]'::jsonb,
  form_title text not null default '',
  form_href text not null default '',
  form_code text not null default '',
  read_back jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_preview_runs_advisor_idx
  on agent_preview_runs (advisor_id, updated_at desc);

create table if not exists agent_form_templates (
  form_code text primary key,
  source_url text not null default '',
  pdf bytea not null,
  fetched_at timestamptz not null default now()
);

alter table agent_preview_runs add column if not exists slug text not null default '';
alter table agent_preview_runs add column if not exists stale_hashes jsonb not null default '[]'::jsonb;
alter table agent_preview_runs add column if not exists form_title text not null default '';
alter table agent_preview_runs add column if not exists form_href text not null default '';
alter table agent_preview_runs add column if not exists form_code text not null default '';
alter table agent_preview_runs add column if not exists draft_active boolean not null default false;
alter table agent_preview_runs add column if not exists designation_conflict text not null default '';
alter table agent_preview_runs add column if not exists read_back jsonb not null default '{}'::jsonb;
alter table agent_preview_runs add column if not exists template_pdf bytea;
