create table if not exists advisor_billing_state (
  advisor_id text primary key,
  version int not null default 1,
  ledger jsonb not null,
  purchases jsonb not null default '[]'::jsonb,
  events jsonb not null default '[]'::jsonb,
  plan_versions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
