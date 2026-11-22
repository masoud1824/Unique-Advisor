-- Per-job claims for the hosted scheduler. Safe to re-run. Does not copy production data.

create table if not exists hosted_jobs (
  job_key text primary key,
  kind text not null,
  advisor_id integer not null default 0,
  status text not null,
  attempt integer not null default 0,
  lease_until timestamptz,
  not_before timestamptz,
  provider_id text not null default '',
  detail text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists drip_recipient_outcomes (
  campaign_id integer not null,
  email text not null,
  status text not null,
  primary key (campaign_id, email)
);

create table if not exists document_mail_threads (
  advisor_id integer primary key,
  conversation_id text not null default '',
  sent_message_id text not null default '',
  sender text not null default '',
  recipient text not null default '',
  subject text not null default '',
  attachment_path text not null default ''
);

create table if not exists document_mail_replies (
  advisor_id integer not null,
  message_id text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  primary key (advisor_id, message_id)
);
