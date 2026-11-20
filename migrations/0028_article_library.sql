create table if not exists library_articles (
  id serial primary key,
  status text not null default 'draft',
  title text not null,
  body_html text not null default '',
  body_text text not null default '',
  image_url text not null default '',
  image_alt text not null default '',
  source_note text not null default '',
  author_note text not null default '',
  topics text not null default '',
  language text not null default 'en',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists library_article_versions (
  id serial primary key,
  article_id integer not null references library_articles(id) on delete cascade,
  version integer not null,
  title text not null,
  body_html text not null,
  body_text text not null,
  image_url text not null default '',
  image_alt text not null default '',
  source_note text not null default '',
  author_note text not null default '',
  topics text not null default '',
  language text not null default '',
  created_at timestamptz not null default now(),
  unique (article_id, version)
);

create index if not exists library_articles_status_idx on library_articles (status, language);
