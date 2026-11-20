create table if not exists platform_card_edits (
  card_id text primary key,
  message text not null default '',
  hidden boolean not null default false
);
