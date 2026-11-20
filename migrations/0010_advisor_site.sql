alter table advisors add column if not exists site_mode text not null default 'builtin';
alter table advisors add column if not exists site_url text not null default '';
alter table advisors add column if not exists public_name text not null default '';
alter table advisors add column if not exists public_title text not null default '';
alter table advisors add column if not exists public_photo text not null default '';
