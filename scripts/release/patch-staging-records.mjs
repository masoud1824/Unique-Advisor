#!/usr/bin/env node
/**
 * Update two staging-review records in place.
 * Does not open the acceptance database and does not replace the practice.
 */
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { assertReleaseDatabase } from "../../src/lib/release-env.ts";

process.env.UA_RELEASE_ENV = "staging";
process.env.UA_RELEASE_DATA_ROOT = "/opt/ua-release/data";
delete process.env.DATABASE_URL;
const sourceDir = resolve("/opt/ua-release/data/staging-review");
assertReleaseDatabase(sourceDir);

const FULL_LETTER = [
  "Dear [Contact Name],",
  "This acceptance letter is a fictional draft about reviewing retirement income.",
  "This paragraph confirms the combined edit works.",
  "Nothing in this draft has been sent.",
].join("\n\n");
const LOCATION = "Fictional desk record. Not a live Zoom or Outlook meeting.";

function torontoToday(hour, minute) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const guess = new Date(Date.UTC(Number(bag.year), Number(bag.month) - 1, Number(bag.day), hour, minute));
  const shown = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const got = Object.fromEntries(shown.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(got.year), Number(got.month) - 1, Number(got.day), Number(got.hour) % 24, Number(got.minute));
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

const beforeCounts = async (pg) => {
  const contacts = await pg.query("select count(*)::int as n from contacts");
  const letters = await pg.query("select count(*)::int as n from saved_letters");
  const drip = await pg.query("select active from drip_campaigns");
  const card = await pg.query("select message from saved_cards");
  return { contacts: contacts.rows[0].n, letters: letters.rows[0].n, dripActive: drip.rows[0].active, card: card.rows[0].message };
};

const pg = new PGlite(sourceDir);
await pg.waitReady;
const before = await beforeCounts(pg);
const advisor = await pg.query("select id from advisors where slug = 'staging-practice'");
const advisorId = Number(advisor.rows[0].id);
const letter = await pg.query("select id, body from saved_letters where advisor_id = $1 and title = $2", [advisorId, "Acceptance — Retirement Note"]);
const packed = JSON.parse(letter.rows[0].body);
packed.body = FULL_LETTER;
await pg.query("update saved_letters set body = $1 where id = $2 and advisor_id = $3", [JSON.stringify(packed), letter.rows[0].id, advisorId]);
const when = torontoToday(16, 0);
const event = await pg.query("select id from desk_calendar_events where advisor_id = $1 and external_id = 'staging-fictional-review'", [advisorId]);
if (!event.rows[0]) throw new Error("The fictional desk event is missing.");
await pg.query(
  "update desk_calendar_events set start_at = $1, location = $2, source = 'Desk', join_url = '' where id = $3 and advisor_id = $4",
  [when.toISOString(), LOCATION, event.rows[0].id, advisorId],
);
const expired = await pg.query("select id from desk_announcements where title = 'Expired staging news'");
if (!expired.rows[0]) {
  await pg.query(
    `insert into desk_announcements (status, title, body, link, priority, language, starts_at, ends_at)
     values ('published', 'Expired staging news', 'This item is past its end time and must stay off the ribbon.', '', 5, 'en', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
  );
}
const after = await beforeCounts(pg);
const stored = JSON.parse((await pg.query("select body from saved_letters where id = $1", [letter.rows[0].id])).rows[0].body);
const meeting = await pg.query("select title, location, join_url, start_at from desk_calendar_events where id = $1", [event.rows[0].id]);
await pg.close();
const report = {
  kind: "staging-record-patch",
  notADatabaseBackup: true,
  fullLetter: stored.body === FULL_LETTER,
  oneSentenceWasNotLeftAsTheWholeLetter: stored.body !== "This paragraph confirms the combined edit works.",
  meetingTitle: meeting.rows[0].title,
  meetingLocation: meeting.rows[0].location,
  meetingJoin: meeting.rows[0].join_url,
  meetingStart: meeting.rows[0].start_at,
  contactsUnchanged: before.contacts === after.contacts,
  letterCountUnchanged: before.letters === after.letters,
  dripStillInactive: after.dripActive === false,
  cardUnchanged: after.card === "Thank you for your trust. It is a pleasure working with you.",
};
if (!report.fullLetter || !report.contactsUnchanged || !report.letterCountUnchanged || !report.dripStillInactive || !report.cardUnchanged || report.meetingJoin !== "") {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
