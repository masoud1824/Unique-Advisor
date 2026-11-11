create table if not exists microsoft_app (
  id integer primary key,
  client_id text not null default '',
  client_secret text not null default '',
  seal_key text not null default ''
);

insert into microsoft_app (id) values (1) on conflict (id) do nothing;
