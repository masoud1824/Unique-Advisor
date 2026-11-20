create table if not exists hidden_catalog_cards (
  advisor_id integer not null references advisors(id) on delete cascade,
  card_id text not null,
  primary key (advisor_id, card_id)
);
