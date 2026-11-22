#!/usr/bin/env node
/**
 * Seed one empty staging Postgres database with the fictional fixture.
 * Refuses production, acceptance, and any database that already has advisors.
 * Prints counts only. Access codes go to a gitignored local file.
 */
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertHostedSeedTarget } from "../hosted-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const databaseUrl = process.env.DATABASE_URL_UNPOOLED?.trim() || "";
if (!databaseUrl) throw new Error("Hosted seed requires DATABASE_URL_UNPOOLED.");
assertHostedSeedTarget(databaseUrl);

const fixture = JSON.parse(await readFile(join(root, "fixtures/sanitized-practice.fixture.json"), "utf8"));
if (fixture.kind !== "sanitized-test-fixture" || fixture.notADatabaseBackup !== true) {
  throw new Error("Refusing to load a file that is not marked as a sanitized fixture.");
}
for (const contact of fixture.contacts) {
  if (contact.email && !contact.email.endsWith("@example.invalid")) {
    throw new Error("Fixture contact is not a fictional address.");
  }
}

const SOURCE_LETTER = [
  "Dear [Contact Name],",
  "This acceptance letter is a fictional draft about reviewing retirement income.",
  "The second paragraph stays available for a revision and is not a client record.",
  "Nothing in this draft has been sent.",
].join("\n\n");
const FULL_LETTER = [
  "Dear [Contact Name],",
  "This acceptance letter is a fictional draft about reviewing retirement income.",
  "This paragraph confirms the combined edit works.",
  "Nothing in this draft has been sent.",
].join("\n\n");
const CARD_BODY = "Thank you for your trust. It is a pleasure working with you.";

function hashCode(code) {
  return createHash("sha256").update(code.trim()).digest("hex");
}
function secret() {
  return randomBytes(18).toString("base64url");
}
function pack(kind, title, body) {
  return JSON.stringify({
    v: kind === "newsletter" ? 1 : 2,
    kind: kind === "newsletter" ? undefined : "eletter",
    design: kind === "newsletter" ? "pine" : "plum",
    kicker: kind === "newsletter" ? "Newsletter" : "Reconstructed fixture. Not a backup.",
    title,
    subject: title,
    body,
    articles: kind === "newsletter" ? body : undefined,
    social: { linkedin: "", instagram: "", facebook: "", youtube: "" },
  });
}

const poolConfig = { connectionString: databaseUrl, max: 1 };
if (/sslmode=require/i.test(databaseUrl)) poolConfig.ssl = { rejectUnauthorized: true };
const pool = new pg.Pool(poolConfig);
const client = await pool.connect();
try {
  const ledger = await client.query("select name from _migrations where name = '0035_hosted_dispatch.sql'");
  if (!ledger.rows[0]) throw new Error("Migrate the empty staging database before seeding it.");
  const existing = await client.query("select count(*)::int as n from advisors");
  if (Number(existing.rows[0].n) > 0) throw new Error("Refusing to seed a database that already has advisors.");

  const operatorPassword = secret();
  const advisorCode = secret();
  const otherCode = secret();
  if (operatorPassword.toLowerCase() === "superadmin" || advisorCode.toLowerCase() === "superadmin") {
    throw new Error("Generated access value was rejected.");
  }
  await client.query("begin");
  await client.query(
    "insert into operators (id, code_hash, code_is_default) values (1, $1, false)",
    [hashCode(operatorPassword)],
  );
  const advisor = await client.query(
    "insert into advisors (slug, practice_name, advisor_name, email, plan, status, code_hash, code_is_default) values ($1, $2, $3, $4, 'professional', 'active', $5, false) returning id",
    ["staging-practice", "Fictional Staging Practice", "Fixture Advisor", "staging-practice@example.invalid", hashCode(advisorCode)],
  );
  const other = await client.query(
    "insert into advisors (slug, practice_name, advisor_name, email, plan, status, code_hash, code_is_default) values ($1, $2, $3, $4, 'professional', 'active', $5, false) returning id",
    ["staging-other", "Other Fictional Desk", "Other Fixture Advisor", "staging-other@example.invalid", hashCode(otherCode)],
  );
  const advisorId = Number(advisor.rows[0].id);
  const otherId = Number(other.rows[0].id);
  for (const contact of fixture.contacts) {
    await client.query(
      "insert into contacts (advisor_id, full_name, email, phone, tags, birthday) values ($1, $2, $3, '', $4, '')",
      [advisorId, contact.name, contact.email, contact.tags],
    );
  }
  await client.query(
    "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)",
    [advisorId, fixture.letter.title, pack("letter", fixture.letter.title, FULL_LETTER)],
  );
  await client.query(
    "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)",
    [advisorId, "Source seed — original fictional retirement draft", pack("letter", "Source seed — original fictional retirement draft", SOURCE_LETTER)],
  );
  await client.query("insert into saved_cards (advisor_id, title, message) values ($1, $2, $3)", [advisorId, fixture.card.title, CARD_BODY]);
  await client.query(
    "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)",
    [advisorId, fixture.newsletterCopy1.title, JSON.stringify({ v: 1, design: "pine", kicker: "Newsletter", title: fixture.newsletterCopy1.title, subject: fixture.newsletterCopy1.title, articles: fixture.newsletterCopy1.articles, social: { linkedin: "", instagram: "", facebook: "", youtube: "" } })],
  );
  await client.query(
    "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)",
    [advisorId, "Test Newsletter (copy 2)", JSON.stringify({ v: 1, design: "pine", kicker: "Newsletter", title: "Test Newsletter (copy 2)", subject: "Test Newsletter (copy 2)", articles: fixture.newsletterCopy2.articles, social: { linkedin: "", instagram: "", facebook: "", youtube: "" } })],
  );
  await client.query("insert into newsletters (advisor_id, token, payload) values ($1, $2, $3)", [advisorId, "fixture-copy-1", JSON.stringify(fixture.newsletterCopy1)]);
  await client.query("insert into newsletters (advisor_id, token, payload) values ($1, $2, $3)", [advisorId, "fixture-copy-2", JSON.stringify(fixture.newsletterCopy2)]);
  await client.query(
    "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)",
    [otherId, "Other advisor newsletter", JSON.stringify({ v: 1, design: "pine", kicker: "Newsletter", title: "Other advisor newsletter", subject: "Other advisor newsletter", articles: [{ title: "Not yours", body: "This newsletter belongs to the other fictional advisor." }], social: { linkedin: "", instagram: "", facebook: "", youtube: "" } })],
  );
  const steps = fixture.drip.steps.map((step, index) => ({ ...step, waitDays: index === 1 ? fixture.drip.step2WaitDays : 0 }));
  await client.query(
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
    const inserted = await client.query(
      `insert into library_articles (status, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language, version)
       values ('published', $1, $2, $3, $4, $5, $6, 'Fixture Advisor', $1, $7, 1) returning id`,
      [title, html, text, image, alt, source, language],
    );
    await client.query(
      `insert into library_article_versions (article_id, version, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language)
       values ($1, 1, $2, $3, $4, $5, $6, $7, 'Fixture Advisor', $2, $8)`,
      [inserted.rows[0].id, title, html, text, image, alt, source, language],
    );
  }
  await client.query(
    `insert into library_articles (status, title, body_html, body_text, source_note, topics, language, version)
     values ('draft', 'Secret Draft', '<p>Hidden draft.</p>', 'Hidden draft.', 'Do not publish', 'Secret Draft', 'en', 1)`,
  );
  await client.query(
    `insert into desk_announcements (status, title, body, link, priority, language) values
     ('published', 'Staging news', 'This ribbon is on the advisor desk only. It is not email.', '', 10, 'en'),
     ('published', 'خبر آزمایشی', 'این نوار فقط روی میز مشاور است و ایمیل نمی‌شود.', '', 20, 'fa'),
     ('draft', 'Draft news', 'This draft stays off the desk.', '', 30, 'en'),
     ('archived', 'Archived news', 'This archived item stays off the desk.', '', 40, 'en')`,
  );
  await client.query(
    `insert into birthday_settings (advisor_id, enabled, source, timezone, feb29, card_title, template_version, confirmed_version, last_run_date, source_ref)
     values ($1, false, 'desk', 'America/Toronto', 'skip', 'Happy birthday, {{name}}. This staging card is not sent.', 1, 0, '', '')`,
    [advisorId],
  );
  await client.query("insert into birthday_notices (advisor_id, run_date, body) values ($1, 'seed', $2)", [advisorId, "Birthday check is off for this staging practice. Nothing was sent."]);
  await client.query(`create table if not exists desk_calendar_events (
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
  await client.query(
    `insert into desk_calendar_events (advisor_id, source, title, start_at, minutes, external_id, location, join_url)
     values ($1, 'Desk', 'Acceptance — fictional review', now() + interval '2 days', 30, 'staging-fictional-review', 'Fictional desk record. Not a live Zoom or Outlook meeting.', '')`,
    [advisorId],
  );
  const drip = await client.query("select active from drip_campaigns where advisor_id = $1", [advisorId]);
  if (drip.rows[0]?.active !== false) throw new Error("Seed left a drip active.");
  await client.query("commit");

  const secretFile = process.env.UA_SEED_SECRET_FILE?.trim() || join(root, "staging-access.local.txt");
  const resolvedSecret = resolve(secretFile);
  if (resolvedSecret.startsWith("/workspace/") || resolvedSecret === "/workspace") throw new Error("Refusing to write access codes into the acceptance tree.");
  const access = [
    "Fictional staging practice only. Not a backup. Do not commit or paste this file.",
    "advisor-slug: staging-practice",
    `advisor-code: ${advisorCode}`,
    "other-advisor-slug: staging-other",
    `other-advisor-code: ${otherCode}`,
    `operator-password: ${operatorPassword}`,
    "Do not use the factory operator word.",
  ].join("\n");
  await writeFile(resolvedSecret, `${access}\n`, { mode: 0o600 });
  await chmod(resolvedSecret, 0o600);
  const report = {
    kind: "hosted-staging-seed",
    notADatabaseBackup: true,
    advisors: 2,
    contacts: fixture.contacts.length,
    letters: 5,
    cards: 1,
    drips: 1,
    activeDrips: 0,
    birthdayEnabled: false,
    secretFile: resolvedSecret,
    printedSecrets: false,
  };
  console.log(JSON.stringify(report));
} catch (error) {
  try { await client.query("rollback"); } catch { /* already closed or not in a transaction */ }
  throw error;
} finally {
  client.release();
  await pool.end();
}
