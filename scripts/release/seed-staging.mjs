#!/usr/bin/env node
/**
 * Seed the staging-review database with labeled fictional records.
 * This is not a backup and it does not open the acceptance database.
 */
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { assertReleaseDatabase } from "../../src/lib/release-env.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
process.env.UA_RELEASE_ENV = "staging";
process.env.UA_RELEASE_DATA_ROOT = "/opt/ua-release/data";
delete process.env.DATABASE_URL;

const sourceDir = "/opt/ua-release/data/staging-review";
assertReleaseDatabase(sourceDir);
if (existsSync(sourceDir)) {
  if (process.env.UA_STAGING_RESEED !== "yes") {
    throw new Error("staging-review already exists. Set UA_STAGING_RESEED=yes to replace only that directory.");
  }
  await rm(sourceDir, { recursive: true, force: true });
}

const fixture = JSON.parse(await readFile(join(root, "fixtures/sanitized-practice.fixture.json"), "utf8"));
if (fixture.kind !== "sanitized-test-fixture" || fixture.notADatabaseBackup !== true) {
  throw new Error("Refusing to load a file that is not marked as a sanitized fixture.");
}

const SOURCE_LETTER = [
  "Dear [Contact Name],",
  "This acceptance letter is a fictional draft about reviewing retirement income.",
  "The second paragraph stays available for a revision and is not a client record.",
  "Nothing in this draft has been sent.",
].join("\n\n");
const PARTIAL_LETTER = "This paragraph confirms the combined edit works.";
const CARD_BODY = "Thank you for your trust. It is a pleasure working with you.";

function hashCode(code) {
  return createHash("sha256").update(code.trim()).digest("hex");
}
function secret() {
  return randomBytes(18).toString("base64url");
}
function social() {
  return { linkedin: "", instagram: "", facebook: "", youtube: "" };
}
function packLetter(title, body) {
  return JSON.stringify({
    v: 2,
    kind: "eletter",
    design: "plum",
    kicker: "Reconstructed fixture. Not a backup.",
    title,
    subject: title,
    body,
    social: social(),
  });
}
function packNewsletter(title, articles) {
  return JSON.stringify({
    v: 1,
    design: "pine",
    kicker: "Newsletter",
    title,
    subject: title,
    articles,
    social: social(),
  });
}

async function applyMigrations(pg) {
  const dir = join(root, "migrations");
  const names = (await readdir(dir)).filter((name) => /^\d+.+\.sql$/.test(name)).sort();
  await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const name of names) {
    const text = await readFile(join(dir, name), "utf8");
    await pg.exec("begin");
    try {
      await pg.exec(text);
      await pg.query("insert into _migrations (name) values ($1)", [name]);
      await pg.exec("commit");
    } catch (error) {
      await pg.exec("rollback");
      throw error;
    }
  }
  return names.length;
}

await mkdir(sourceDir, { recursive: true });
const pg = new PGlite(sourceDir);
await pg.waitReady;
const migrationCount = await applyMigrations(pg);

const operatorPassword = secret();
const advisorCode = secret();
const otherCode = secret();
await pg.query(
  "insert into operators (id, code_hash, code_is_default) values (1, $1, true)",
  [hashCode("superadmin")],
);

async function insertAdvisor(slug, practice, name, code) {
  const inserted = await pg.query(
    "insert into advisors (slug, practice_name, advisor_name, email, plan, status, code_hash, code_is_default) values ($1, $2, $3, $4, 'professional', 'active', $5, false) returning id",
    [slug, practice, name, `${slug}@example.invalid`, hashCode(code)],
  );
  return Number(inserted.rows[0].id);
}

const advisorId = await insertAdvisor("staging-practice", "Fictional Staging Practice", "Fixture Advisor", advisorCode);
const otherId = await insertAdvisor("staging-other", "Other Fictional Desk", "Other Fixture Advisor", otherCode);

for (const contact of fixture.contacts) {
  await pg.query(
    "insert into contacts (advisor_id, full_name, email, phone, tags, birthday) values ($1, $2, $3, '', $4, '')",
    [advisorId, contact.name, contact.email, contact.tags],
  );
}

await pg.query(
  "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)",
  [advisorId, fixture.letter.title, packLetter(fixture.letter.title, PARTIAL_LETTER)],
);
await pg.query(
  "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)",
  [advisorId, "Source seed — original fictional retirement draft", packLetter("Source seed — original fictional retirement draft", SOURCE_LETTER)],
);
await pg.query(
  "insert into saved_cards (advisor_id, title, message) values ($1, $2, $3)",
  [advisorId, fixture.card.title, CARD_BODY],
);

const copy1 = packNewsletter(fixture.newsletterCopy1.title, fixture.newsletterCopy1.articles);
const copy2Title = "Test Newsletter (copy 2)";
const copy2 = packNewsletter(copy2Title, fixture.newsletterCopy2.articles);
await pg.query("insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)", [advisorId, fixture.newsletterCopy1.title, copy1]);
await pg.query("insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)", [advisorId, copy2Title, copy2]);
await pg.exec(`create table if not exists newsletters (
  id bigserial primary key,
  advisor_id integer not null,
  token text not null,
  payload text not null default '{}'
)`);
await pg.query("insert into newsletters (advisor_id, token, payload) values ($1, $2, $3)", [advisorId, "fixture-copy-1", JSON.stringify(fixture.newsletterCopy1)]);
await pg.query("insert into newsletters (advisor_id, token, payload) values ($1, $2, $3)", [advisorId, "fixture-copy-2", JSON.stringify(fixture.newsletterCopy2)]);

const otherNewsletter = await pg.query(
  "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3) returning id",
  [otherId, "Other advisor newsletter", packNewsletter("Other advisor newsletter", [{ title: "Not yours", body: "This newsletter belongs to the other fictional advisor." }])],
);
const otherNewsletterId = Number(otherNewsletter.rows[0].id);

await pg.exec(`create table if not exists drip_campaigns (
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
const steps = fixture.drip.steps.map((step, index) => ({ ...step, waitDays: index === 1 ? fixture.drip.step2WaitDays : 0 }));
await pg.query(
  "insert into drip_campaigns (advisor_id, name, steps, every_days, active, design, contact_ids) values ($1, $2, $3, $4, false, 'plum', '[]')",
  [advisorId, fixture.drip.name, JSON.stringify(steps), fixture.drip.everyDays],
);

const articles = [
  ["Life Insurance", "<p>Life insurance is the money a family can use if the person earning the income is no longer there. This staging copy is fictional.</p>", "Internal staging note", "", "", "en"],
  ["Time Value Of Money", "<p><strong>Waiting</strong> has a cost. This staging copy is fictional.</p>", "Internal desk note", "https://example.invalid/coins.jpg", "coins", "en"],
  ["Retirement Planning", "<p>Retirement planning is a check of income for later years.</p>", "Internal staging note", "", "", "en"],
  ["Keeping Beneficiary Information Updated", "<p>Beneficiary information should name the people who are meant to receive the proceeds. This staging copy is fictional.</p>", "Internal staging note", "", "", "en"],
  ["Practice Follow-Up", "<p>This is a fictional acceptance-test article.</p>", "Internal staging note", "", "", "en"],
];
for (const [title, html, source, image, alt, language] of articles) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const inserted = await pg.query(
    `insert into library_articles (status, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language, version)
     values ('published', $1, $2, $3, $4, $5, $6, 'Fixture Advisor', $1, $7, 1) returning id`,
    [title, html, text, image, alt, source, language],
  );
  await pg.query(
    `insert into library_article_versions (article_id, version, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language)
     values ($1, 1, $2, $3, $4, $5, $6, $7, 'Fixture Advisor', $2, $8)`,
    [inserted.rows[0].id, title, html, text, image, alt, source, language],
  );
}
await pg.query(
  `insert into library_articles (status, title, body_html, body_text, source_note, topics, language, version)
   values ('draft', 'Secret Draft', '<p>Hidden draft.</p>', 'Hidden draft.', 'Do not publish', 'Secret Draft', 'en', 1)`,
);

await pg.query(
  `insert into desk_announcements (status, title, body, link, priority, language) values
   ('published', 'Staging news', 'This ribbon is on the advisor desk only. It is not email.', '', 10, 'en'),
   ('published', 'خبر آزمایشی', 'این نوار فقط روی میز مشاور است و ایمیل نمی‌شود.', '', 20, 'fa'),
   ('draft', 'Draft news', 'This draft stays off the desk.', '', 30, 'en'),
   ('archived', 'Archived news', 'This archived item stays off the desk.', '', 40, 'en')`,
);

await pg.query(
  `insert into birthday_settings (advisor_id, enabled, source, timezone, feb29, card_title, template_version, confirmed_version, last_run_date, source_ref)
   values ($1, false, 'desk', 'America/Toronto', 'skip', 'Happy birthday, {{name}}. This staging card is not sent.', 1, 0, '', '')`,
  [advisorId],
);
await pg.query(
  "insert into birthday_notices (advisor_id, run_date, body) values ($1, 'seed', $2)",
  [advisorId, "Birthday check is off for this staging practice. Nothing was sent."],
);

const when = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
when.setUTCMinutes(0, 0, 0);
await pg.exec(`create table if not exists desk_calendar_events (
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
await pg.query(
  `insert into desk_calendar_events (advisor_id, source, title, start_at, minutes, external_id, location, join_url)
   values ($1, 'Desk', 'Acceptance — fictional review', $2, 30, 'staging-fictional-review', 'Fictional desk record. Not a live Zoom or Outlook meeting.', '')`,
  [advisorId, when.toISOString()],
);

const letter = await pg.query("select title, body from saved_letters where advisor_id = $1 and title = $2", [advisorId, fixture.letter.title]);
const source = await pg.query("select body from saved_letters where advisor_id = $1 and title = $2", [advisorId, "Source seed — original fictional retirement draft"]);
const card = await pg.query("select message from saved_cards where advisor_id = $1", [advisorId]);
const drip = await pg.query("select name, steps, every_days, active, design from drip_campaigns where advisor_id = $1", [advisorId]);
const birthday = await pg.query("select enabled, confirmed_version from birthday_settings where advisor_id = $1", [advisorId]);
const operator = await pg.query("select code_is_default, code_hash from operators where id = 1");
const draft = await pg.query("select status from library_articles where title = 'Secret Draft'");
const published = await pg.query("select count(*)::int as n from library_articles where status = 'published'");
const parsedLetter = JSON.parse(letter.rows[0].body);
const parsedSource = JSON.parse(source.rows[0].body);
const parsedSteps = JSON.parse(drip.rows[0].steps);

const report = {
  kind: "staging-fictional-seed",
  notADatabaseBackup: true,
  fullEditedLetterAvailable: false,
  partialLetterOnly: parsedLetter.body === PARTIAL_LETTER,
  sourceSeedIsOriginalDraft: parsedSource.body === SOURCE_LETTER,
  sourceSeedIsNotThePartialLetter: parsedSource.body !== PARTIAL_LETTER,
  cardMatches: card.rows[0].message === CARD_BODY,
  dripInactive: drip.rows[0].active === false,
  dripDesign: drip.rows[0].design,
  everyDays: Number(drip.rows[0].every_days),
  step2Wait: parsedSteps[1]?.waitDays === 3,
  birthdayEnabled: birthday.rows[0].enabled,
  birthdayConfirmed: Number(birthday.rows[0].confirmed_version),
  operatorStillDefault: operator.rows[0].code_is_default === true && operator.rows[0].code_hash === hashCode("superadmin"),
  draftHidden: draft.rows[0].status === "draft",
  publishedArticles: published.rows[0].n,
  migrationCount,
  advisorId,
  otherAdvisorId: otherId,
  otherNewsletterId,
  database: sourceDir,
};
const ok = report.partialLetterOnly && report.sourceSeedIsOriginalDraft && report.cardMatches && report.dripInactive && report.step2Wait && report.everyDays === 7 && report.birthdayEnabled === false && report.operatorStillDefault && report.draftHidden && report.publishedArticles === 5;
if (!ok) {
  console.error(JSON.stringify(report, null, 2));
  await pg.close();
  process.exit(1);
}
await pg.close();

await mkdir("/opt/ua-release/run", { recursive: true });
await writeFile("/opt/ua-release/run/staging-operator.password", `${operatorPassword}\n`, { mode: 0o600 });
await chmod("/opt/ua-release/run/staging-operator.password", 0o600);
const access = [
  "Fictional staging practice only. Not the acceptance desk. Not a website login link.",
  "operator-password-file: /opt/ua-release/run/staging-operator.password",
  `advisor-slug: staging-practice`,
  `advisor-code: ${advisorCode}`,
  `other-advisor-slug: staging-other`,
  `other-advisor-code: ${otherCode}`,
  "The word superadmin is rejected.",
  "The full edited letter, with its greeting and other paragraphs plus the revised sentence, is not in this conversation and was not invented.",
].join("\n");
await writeFile("/opt/ua-release/run/staging-access.txt", `${access}\n`, { mode: 0o600 });
await chmod("/opt/ua-release/run/staging-access.txt", 0o600);
console.log(JSON.stringify(report, null, 2));
