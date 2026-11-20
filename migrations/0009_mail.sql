alter table advisors add column if not exists mail_from text not null default '';
alter table advisors add column if not exists mail_name text not null default '';
alter table advisors add column if not exists mail_host text not null default '';
alter table advisors add column if not exists mail_port integer not null default 587;
alter table advisors add column if not exists mail_user text not null default '';
alter table advisors add column if not exists mail_pass text not null default '';
