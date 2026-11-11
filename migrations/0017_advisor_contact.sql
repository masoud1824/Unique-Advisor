alter table advisors add column if not exists public_phone text not null default '';
alter table advisors add column if not exists public_card_email text not null default '';
alter table advisors add column if not exists public_company text not null default '';
alter table advisors add column if not exists public_website text not null default '';
