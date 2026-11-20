import { getSql } from "@/lib/db";
import { packEletter } from "@/lib/eletter";
import { emptySocial, packNewsletter } from "@/lib/newsletter.ts";

const CONTACTS = [
  ["Casey Sample", "casey.sample@example.invalid", "Acceptance, Life Insurance Client"],
  ["Riley Sample", "riley.sample@example.invalid", "Acceptance, Life Insurance Client"],
  ["Quinn Sample", "quinn.sample@example.invalid", "Acceptance, Unsubscribed, Life Insurance Client"],
  ["Avery Sample", "", "Acceptance, Life Insurance Client"],
  ["Morgan Sample", "morgan.sample@example.invalid", "Acceptance, TFSA Client"],
  ["Jordan Example", "jordan.example@example.invalid", "Acceptance, Dropbox fictional, Life Insurance Client"],
];

export const ACCEPTANCE_LETTER_TITLE = "Acceptance — Retirement Note";
export const ACCEPTANCE_LETTER_BODY = [
  "Dear [Contact Name],",
  "This acceptance letter is a fictional draft about reviewing retirement income.",
  "The second paragraph stays available for a revision and is not a client record.",
  "Nothing in this draft has been sent.",
].join("\n\n");

export const ACCEPTANCE_NEWSLETTER_TITLE = "Test Newsletter";
export const ACCEPTANCE_NEWSLETTER_ARTICLES: Array<[string, string]> = [
  ["Life Insurance", "Life insurance is the money a family can use if the person earning the income is no longer there. This acceptance copy is fictional."],
  ["Retirement Planning", "Retirement planning is a check of income for later years. This acceptance copy is fictional."],
  ["Keeping Beneficiary Information Updated", "Beneficiary information should name the people who are meant to receive the proceeds. This acceptance copy is fictional."],
  ["Time Value Of Money", "A dollar available now can be put to work, so waiting has a cost. This acceptance copy is fictional."],
];

const ACCEPTANCE_CAMPAIGN = "Acceptance — Welcome Drip";
const ACCEPTANCE_CAMPAIGN_STEPS = JSON.stringify([
  { title: "Welcome", body: "This is the first fictional article in the acceptance campaign. It has not been started." },
  { title: "Next step", body: "This second article stays in the saved campaign until a recipient and approval are given." },
]);

function packedLetter() {
  return packEletter({
    kind: "eletter",
    design: "plum",
    kicker: "A letter",
    title: ACCEPTANCE_LETTER_TITLE,
    subject: ACCEPTANCE_LETTER_TITLE,
    body: ACCEPTANCE_LETTER_BODY,
    social: emptySocial(),
  });
}

function packedNewsletter() {
  const articles = ACCEPTANCE_NEWSLETTER_ARTICLES.map(([title, body]) => ({ title, body }));
  return packNewsletter({
    design: "pine" as const,
    kicker: "Newsletter",
    title: ACCEPTANCE_NEWSLETTER_TITLE,
    subject: ACCEPTANCE_NEWSLETTER_TITLE,
    articles,
    social: emptySocial(),
  });
}

export async function ensureAcceptanceRecords(advisorId: number) {
  const sql = await getSql();
  for (const [name, email, tags] of CONTACTS) {
    const found = await sql`select id from contacts where advisor_id = ${advisorId} and full_name = ${name} limit 1`;
    if (!found[0]) {
      await sql`insert into contacts (advisor_id, full_name, email, phone, tags) values (${advisorId}, ${name}, ${email}, '', ${tags})`;
    } else {
      await sql`update contacts set email = ${email}, tags = ${tags} where id = ${Number(found[0].id)} and advisor_id = ${advisorId}`;
    }
  }
  await sql.query(`create table if not exists useful_links (
    id serial primary key,
    advisor_id integer not null,
    label text not null,
    url text not null,
    created_at timestamptz not null default now()
  )`);
  const linkLabel = "Acceptance — ivari forms";
  const link = await sql`select id from useful_links where advisor_id = ${advisorId} and label = ${linkLabel} limit 1`;
  if (!link[0]) {
    await sql`insert into useful_links (advisor_id, label, url) values (${advisorId}, ${linkLabel}, ${"https://ivari.ca/resources/faq/forms-and-guides/"})`;
  }
  const letterTitle = ACCEPTANCE_LETTER_TITLE;
  const letter = await sql`select id from saved_letters where advisor_id = ${advisorId} and title = ${letterTitle} limit 1`;
  if (!letter[0]) {
    await sql`insert into saved_letters (advisor_id, title, subject, body) values (${advisorId}, ${letterTitle}, ${letterTitle}, ${packedLetter()})`;
  }
  await sql.query(`create table if not exists drip_campaigns (
    id bigserial primary key,
    advisor_id integer not null,
    name text not null,
    tag text not null default '',
    steps text not null default '[]',
    every_days integer not null default 7,
    active boolean not null default false,
    next_index integer not null default 0,
    next_at timestamptz,
    contact_ids text not null default '[]',
    design text not null default 'plum',
    created_at timestamptz not null default now()
  )`);
  const campaign = ACCEPTANCE_CAMPAIGN;
  const existing = await sql`select id from drip_campaigns where advisor_id = ${advisorId} and name = ${campaign} limit 1`;
  if (!existing[0]) {
    const steps = ACCEPTANCE_CAMPAIGN_STEPS;
    await sql`
      insert into drip_campaigns (advisor_id, name, tag, steps, every_days, active, next_index, next_at, contact_ids, design)
      values (${advisorId}, ${campaign}, '', ${steps}, 7, false, 0, null, '[]', 'plum')
    `;
  }
  const newsletterTitle = ACCEPTANCE_NEWSLETTER_TITLE;
  const newsletter = await sql`select id from saved_letters where advisor_id = ${advisorId} and title = ${newsletterTitle} limit 1`;
  if (!newsletter[0]) {
    await sql`insert into saved_letters (advisor_id, title, subject, body) values (${advisorId}, ${newsletterTitle}, ${newsletterTitle}, ${packedNewsletter()})`;
  }
  await sql.query(`create table if not exists desk_calendar_events (
    id serial primary key,
    advisor_id integer not null,
    source text not null,
    title text not null,
    start_at timestamptz not null,
    minutes integer not null default 30,
    external_id text not null default '',
    location text not null default '',
    join_url text not null default ''
  )`);
  await sql.query("alter table desk_calendar_events add column if not exists external_id text not null default ''");
  await sql.query("alter table desk_calendar_events add column if not exists location text not null default ''");
  await sql.query("alter table desk_calendar_events add column if not exists join_url text not null default ''");
  const meeting = "acceptance-fictional-review";
  const when = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  when.setUTCMinutes(0, 0, 0);
  const savedMeeting = await sql`select id from desk_calendar_events where advisor_id = ${advisorId} and external_id = ${meeting} limit 1`;
  if (!savedMeeting[0]) {
    await sql`
      insert into desk_calendar_events (advisor_id, source, title, start_at, minutes, external_id, location, join_url)
      values (${advisorId}, ${"Desk"}, ${"Acceptance — fictional review"}, ${when.toISOString()}, 30, ${meeting}, ${"Fictional desk record. Not a live Zoom or Outlook meeting."}, ${""})
    `;
  } else {
    await sql`update desk_calendar_events set start_at = ${when.toISOString()}, location = ${"Fictional desk record. Not a live Zoom or Outlook meeting."} where id = ${Number(savedMeeting[0].id)} and advisor_id = ${advisorId}`;
  }
}

/** Put the labelled drafts back to the start of the acceptance checklist. */
export async function resetAcceptanceDrafts(advisorId: number) {
  await ensureAcceptanceRecords(advisorId);
  const sql = await getSql();
  await sql`update saved_letters set subject = ${ACCEPTANCE_LETTER_TITLE}, body = ${packedLetter()} where advisor_id = ${advisorId} and title = ${ACCEPTANCE_LETTER_TITLE}`;
  await sql`update saved_letters set subject = ${ACCEPTANCE_NEWSLETTER_TITLE}, body = ${packedNewsletter()} where advisor_id = ${advisorId} and title = ${ACCEPTANCE_NEWSLETTER_TITLE}`;
  await sql`update drip_campaigns set steps = ${ACCEPTANCE_CAMPAIGN_STEPS}, every_days = 7, active = false, next_index = 0, next_at = null, contact_ids = ${"[]"} where advisor_id = ${advisorId} and name = ${ACCEPTANCE_CAMPAIGN}`;
  await sql`delete from saved_cards where advisor_id = ${advisorId} and title = ${"Thank You"}`;
  try {
    await sql`update assistant_actions set status = 'discarded' where advisor_id = ${advisorId} and status = 'pending' and kind = 'newsletter-preview' and summary like ${"Test Newsletter%"}`;
  } catch {
    /* A missing preview table should not block the labelled drafts. */
  }
}

const CHECKLIST_ECHOES = [
  "This acceptance letter is a fictional draft",
  "This paragraph was revised on its own",
  "Acceptance — Welcome Drip",
  "Simulated form record for “Acceptance — ivari forms”",
  "Acceptance — fictional review",
  "Contacts tagged Life Insurance Client",
  "No contacts match receive mail among life insurance clients",
  "Which saved page?",
  "Time Value Of Money” is now article 2",
  "Simulated. Live Dropbox Sign was not called.",
  "A new message was not created.",
];

/** Remove desk lines written by the checklist harness, not by the advisor. */
export async function removeChecklistEchoes(advisorId: number) {
  const sql = await getSql();
  const rows = await sql`select id, content from assistant_messages where advisor_id = ${advisorId} order by id desc limit 80`;
  const ids = rows
    .filter((row) => CHECKLIST_ECHOES.some((mark) => String(row.content || "").includes(mark)))
    .map((row) => Number(row.id))
    .filter((id) => id > 0);
  for (const id of ids) {
    await sql`delete from assistant_messages where id = ${id} and advisor_id = ${advisorId}`;
  }
  return ids.length;
}
