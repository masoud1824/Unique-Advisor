import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { advisorRibbonLanguage, displayedDeskLanguage, RIBBON_LANGUAGE_FALLBACK, visibleAnnouncements } from "./news-ribbon.ts";
import {
  BIRTHDAY_AUTOMATION_OFF,
  confirmBirthdayCard,
  pauseBirthdayCheck,
  previewBirthdayDesk,
  readBirthdayDesk,
  saveBirthdaySettings,
} from "./birthday-desk.ts";

const dir = await mkdtemp(join("/opt/ua-release/data", "birthday-desk-test-"));
const pg = new PGlite(dir);
await pg.waitReady;
await pg.exec(`
  create table advisors (id serial primary key, slug text);
  insert into advisors (slug) values ('one'), ('two');
  create table contacts (
    id serial primary key, advisor_id integer, full_name text, email text default '', birthday text default '', tags text default ''
  );
  create table saved_cards (id serial primary key, advisor_id integer, title text, message text);
  create table birthday_settings (
    advisor_id integer primary key, enabled boolean not null default false, source text not null default '',
    timezone text not null default 'America/Toronto', feb29 text not null default 'skip', card_title text not null default '',
    template_version integer not null default 1, confirmed_version integer not null default 0, last_run_date text not null default '',
    source_ref text not null default '', updated_at timestamptz not null default now()
  );
  create table birthday_notices (
    id serial primary key, advisor_id integer, run_date text, body text, created_at timestamptz not null default now()
  );
  insert into contacts (advisor_id, full_name, email, birthday, tags) values
    (1, 'Casey Sample', 'casey.sample@example.invalid', '', 'Acceptance'),
    (1, 'Quinn Sample', 'quinn.sample@example.invalid', '1990-01-02', 'Unsubscribed');
  insert into saved_cards (advisor_id, title, message) values
    (1, 'Thank You', 'Thank you for your trust. It is a pleasure working with you.'),
    (1, 'Birthday', 'Happy birthday, {{name}}.');
  insert into birthday_notices (advisor_id, run_date, body) values (1, 'seed', 'Birthday check is off. Nothing was sent.');
  insert into birthday_settings (advisor_id, enabled, source, card_title, template_version, confirmed_version) values (2, false, 'desk', 'Other card', 1, 1);
`);
const sql = { query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => pg.query<T>(text, params).then((result) => result.rows) };

after(async () => {
  await pg.close();
  await rm(dir, { recursive: true, force: true });
});

describe("birthday settings stay off and advisor-scoped", () => {
  it("refuses to turn automation on and does not change the other advisor", async () => {
    const refused = await saveBirthdaySettings(sql, 1, { enabled: true, cardTitle: "Happy birthday, {{name}}." });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error, BIRTHDAY_AUTOMATION_OFF);
    const other = await pg.query<{ card_title: string }>("select card_title from birthday_settings where advisor_id = 2");
    assert.equal(other.rows[0]?.card_title, "Other card");
  });

  it("saves an existing card, confirms it, and can turn the 9:00 check on without sending", async () => {
    const card = "Thank you for your trust. It is a pleasure working with you.";
    const saved = await saveBirthdaySettings(sql, 1, {
      source: "desk",
      timezone: "America/Toronto",
      feb29: "skip",
      cardTitle: card,
      enabled: false,
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.storedEnabled, false);
    assert.equal(saved.needsConfirmation, true);
    assert.equal(saved.sent, false);
    assert.equal(saved.missingDates[0].name, "Casey Sample");
    const tooSoon = await saveBirthdaySettings(sql, 1, { enabled: true });
    assert.equal(tooSoon.ok, false);
    const confirmed = await confirmBirthdayCard(sql, 1);
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.equal(confirmed.needsConfirmation, false);
    assert.equal(confirmed.storedEnabled, false);
    assert.equal(confirmed.sent, false);
    const on = await saveBirthdaySettings(sql, 1, { enabled: true });
    assert.equal(on.ok, true);
    if (!on.ok) return;
    assert.equal(on.storedEnabled, true);
    assert.equal(on.sent, false);
    const changed = await saveBirthdaySettings(sql, 1, { cardTitle: "Happy birthday, {{name}}." });
    assert.equal(changed.ok, true);
    if (!changed.ok) return;
    assert.equal(changed.needsConfirmation, true);
    assert.equal(changed.storedEnabled, false);
    const paused = await pauseBirthdayCheck(sql, 1);
    assert.equal(paused.ok, true);
    if (!paused.ok) return;
    assert.equal(paused.storedEnabled, false);
    const cross = await saveBirthdaySettings(sql, 1, { advisorId: 2, cardTitle: "Stolen" });
    assert.equal(cross.ok, false);
    const other = await pg.query<{ card_title: string }>("select card_title from birthday_settings where advisor_id = 2");
    assert.equal(other.rows[0]?.card_title, "Other card");
  });

  it("previews with a fake clock and does not call a provider", async () => {
    const preview = previewBirthdayDesk({
      advisorId: 1,
      settings: {
        enabled: false,
        source: "desk",
        timezone: "America/Toronto",
        feb29: "skip",
        templateVersion: 1,
        confirmedVersion: 1,
        cardTitle: "Happy birthday, {{name}}.",
      },
      people: [{ contactId: "1", name: "Casey Sample", email: "casey.sample@example.invalid", birthday: "", unsubscribed: false }],
      now: new Date("2026-11-20T14:00:00.000Z"),
    });
    assert.equal(preview.providerCalled, false);
    assert.equal(preview.schedulerRan, false);
    assert.equal(preview.live, false);
    assert.match(preview.notice, /off/);
  });
});

describe("desk ribbon language", () => {
  it("uses English unless the advisor chose Farsi, and hides expired items", () => {
    assert.equal(advisorRibbonLanguage(""), "en");
    assert.equal(advisorRibbonLanguage("fr"), "en");
    assert.equal(advisorRibbonLanguage("fa-IR"), "fa");
    assert.equal(displayedDeskLanguage("fa-IR"), "en");
    assert.match(RIBBON_LANGUAGE_FALLBACK, /English/);
    const now = new Date("2026-11-20T15:00:00.000Z");
    const items = visibleAnnouncements([
      { id: 1, title: "English", text: "en", link: "", priority: 2, language: "en", status: "published", startsAt: "", endsAt: "" },
      { id: 2, title: "فارسی", text: "fa", link: "", priority: 1, language: "fa", status: "published", startsAt: "", endsAt: "" },
      { id: 3, title: "Expired", text: "old", link: "", priority: 1, language: "fa", status: "published", startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-01-02T00:00:00.000Z" },
    ], now, "fa");
    assert.deepEqual(items.map((item) => item.title), ["فارسی"]);
  });
});
