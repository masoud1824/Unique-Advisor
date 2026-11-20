import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { asksLibraryConversation, libraryTurnAllowsSend } from "./library-conversation.ts";
import { applyCopyEdits, performLibraryTurn, saveLibraryRecord, type QuerySql } from "./library-store.ts";
import { snapshotPublished, type LibraryArticle } from "./article-library.ts";
import { unpackNewsletter } from "./newsletter.ts";
import { asksArchiveSearch } from "./delivery-audience.ts";
import { prepareDeskCommand } from "./voice-desk.ts";

const dir = `/opt/ua-release/data/library-turn-test-${process.pid}`;
let pg: PGlite;
let sql: QuerySql;

function wrap(database: PGlite): QuerySql {
  return {
    async query(text, params = []) {
      const result = await database.query(text, params);
      return result.rows;
    },
  };
}

describe("article library conversation and snapshots", () => {
  before(async () => {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    pg = new PGlite(dir);
    await pg.waitReady;
    sql = wrap(pg);
    await pg.exec(`
      create table advisors (id serial primary key, slug text not null, practice_name text not null default '', advisor_name text not null default '');
      create table library_articles (
        id serial primary key, status text not null default 'draft', title text not null,
        body_html text not null default '', body_text text not null default '',
        image_url text not null default '', image_alt text not null default '',
        source_note text not null default '', author_note text not null default '',
        topics text not null default '', language text not null default 'en',
        version integer not null default 1, updated_at timestamptz not null default now()
      );
      create table library_article_versions (
        id serial primary key, article_id integer not null, version integer not null,
        title text not null, body_html text not null, body_text text not null,
        image_url text not null default '', image_alt text not null default '',
        source_note text not null default '', author_note text not null default '',
        topics text not null default '', language text not null default ''
      );
      create table saved_letters (
        id serial primary key, advisor_id integer not null, title text not null,
        subject text not null default '', body text not null
      );
    `);
    await sql.query("insert into advisors (slug, practice_name, advisor_name) values ('one', 'One', 'One'), ('two', 'Two', 'Two')");
    await sql.query(
      `insert into library_articles (status, title, body_html, body_text, image_url, image_alt, source_note, version)
       values
       ('published', 'Time Value Of Money', '<p><strong>Waiting</strong> has a cost.</p>', 'Waiting has a cost.', 'https://example.invalid/coins.jpg', 'coins', 'Internal desk note', 3),
       ('published', 'Life Insurance', '<p>A family benefit.</p>', 'A family benefit.', '', '', 'Internal desk note', 1),
       ('draft', 'Secret Draft', '<p>hidden</p>', 'hidden draft words', '', '', '', 1)`,
    );
  });

  after(async () => {
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("routes English and Farsi library requests without treating them as the newsletter archive", () => {
    const english = "Search the article library for the time value of money. Do not send it.";
    const farsi = "در کتابخانه مقاله‌ها عبارت ارزش زمانی پول را جستجو کن. چیزی نفرست.";
    const copy = "Copy Time Value Of Money and Life Insurance from the article library into a new newsletter. Do not add recipients.";
    assert.equal(asksLibraryConversation(english), "search");
    assert.equal(asksLibraryConversation(prepareDeskCommand(farsi)), "search");
    assert.equal(asksLibraryConversation(copy), "copy");
    assert.equal(asksLibraryConversation("Search the newsletter archive for the time value of money."), "");
    assert.equal(asksArchiveSearch(english), false);
    assert.equal(libraryTurnAllowsSend(copy), false);
    assert.equal(libraryTurnAllowsSend(prepareDeskCommand(farsi)), false);
  });

  it("searches published articles for an advisor and hides drafts", async () => {
    const english = await performLibraryTurn(sql, 1, "Search the article library for the time value of money. Do not send it.");
    assert.match(english, /Time Value Of Money/);
    assert.match(english, /version 3/);
    assert.match(english, /Internal desk note/);
    assert.doesNotMatch(english, /Secret Draft/);
    const farsi = await performLibraryTurn(sql, 1, prepareDeskCommand("در کتابخانه مقاله‌ها عبارت ارزش زمانی پول را جستجو کن. چیزی نفرست."));
    assert.match(farsi, /Time Value Of Money/);
    assert.match(farsi, /Nothing was copied or sent/);
  });

  it("copies several articles with no recipients and keeps the snapshot after the library changes", async () => {
    const reply = await performLibraryTurn(sql, 1, "Copy Time Value Of Money and Life Insurance from the article library into a new newsletter. Do not add recipients.");
    assert.match(reply, /2 library snapshots/);
    assert.match(reply, /No recipients/);
    assert.match(reply, /Nothing was sent/);
    const saved = await sql.query<{ id: number; body: string }>("select id, body from saved_letters where advisor_id = 1 order by id desc limit 1");
    const issue = unpackNewsletter(saved[0].body);
    assert.equal(issue?.articles.length, 2);
    assert.equal(JSON.stringify(issue).includes("recipients"), false);
    const time = issue?.articles.find((item) => item.title === "Time Value Of Money");
    assert.equal(time?.bodyHtml, "<p><strong>Waiting</strong> has a cost.</p>");
    assert.equal(time?.imageUrl, "https://example.invalid/coins.jpg");
    assert.equal(time?.imageAlt, "coins");
    assert.equal(time?.sourceNote, "Internal desk note");
    assert.equal(time?.libraryVersion, 3);
    await sql.query("update library_articles set title = 'Changed later', body_html = '<p>new</p>', version = 4 where title = 'Time Value Of Money'");
    const reread = unpackNewsletter((await sql.query<{ body: string }>("select body from saved_letters where id = $1", [saved[0].id]))[0].body);
    const frozen = reread?.articles.find((item) => item.libraryArticleId === time?.libraryArticleId);
    assert.equal(frozen?.title, "Time Value Of Money");
    assert.equal(frozen?.bodyHtml, "<p><strong>Waiting</strong> has a cost.</p>");
    assert.equal(frozen?.libraryVersion, 3);
    await sql.query("update library_articles set title = 'Time Value Of Money', body_html = '<p><strong>Waiting</strong> has a cost.</p>', version = 3 where id = $1", [time?.libraryArticleId]);
  });

  it("copies from a Farsi request and refuses another advisor's newsletter", async () => {
    const before = await sql.query<{ id: number }>("select id from saved_letters where advisor_id = 2");
    const owned = await sql.query<{ id: number; body: string }>("select id, body from saved_letters where advisor_id = 1 order by id limit 1");
    const reply = await performLibraryTurn(sql, 2, `Copy Time Value Of Money from the article library into existing newsletter ${owned[0].id}. Do not send.`);
    assert.match(reply, /another advisor/);
    const after = await sql.query<{ body: string }>("select body from saved_letters where id = $1", [owned[0].id]);
    assert.equal(after[0].body, owned[0].body);
    assert.equal(before.length, 0);
    const farsi = await performLibraryTurn(sql, 2, prepareDeskCommand("مقاله‌های ارزش زمانی و بیمه عمر را از کتابخانه مقاله‌ها در یک خبرنامه جدید کپی کن. گیرنده‌ای نگذار."));
    assert.match(farsi, /2 library snapshots/);
    assert.match(farsi, /No recipients/);
  });

  it("lets only a superadmin add a library article, and an advisor edit stays on the copy", async () => {
    const countBefore = await sql.query<{ n: number }>("select count(*)::int as n from library_articles");
    await assert.rejects(() => saveLibraryRecord(sql, { role: "advisor" }, { title: "Nope", bodyHtml: "<p>No</p>", publish: true }), /superadmin/);
    const countAfter = await sql.query<{ n: number }>("select count(*)::int as n from library_articles");
    assert.equal(countAfter[0].n, countBefore[0].n);
    const savedId = await saveLibraryRecord(sql, { role: "superadmin" }, {
      title: "Desk note",
      bodyHtml: "<p>Hello</p><script>bad()</script>",
      imageUrl: "https://example.invalid/a.jpg",
      imageAlt: "a desk",
      sourceNote: "Typed by superadmin",
      publish: true,
    });
    assert.equal(savedId.status, "published");
    const row = (await sql.query<Record<string, unknown>>("select * from library_articles where id = $1", [savedId.id]))[0];
    const published = {
      id: Number(row.id),
      status: "published" as const,
      title: String(row.title),
      bodyHtml: String(row.body_html),
      bodyText: String(row.body_text),
      imageUrl: String(row.image_url),
      imageAlt: String(row.image_alt),
      sourceNote: String(row.source_note),
      authorNote: "",
      topics: "",
      language: "en",
      version: 1,
      updatedAt: "",
    } satisfies LibraryArticle;
    assert.equal(published.bodyHtml.includes("script"), false);
    const snapshot = snapshotPublished(published);
    const edited = applyCopyEdits([snapshot], [{ id: snapshot.libraryArticleId, bodyHtml: "<p><em>My wording</em></p>" }]);
    assert.match(String(edited[0].bodyHtml), /My wording/);
    assert.equal(snapshot.bodyHtml, published.bodyHtml);
    const still = await sql.query<{ body_html: string }>("select body_html from library_articles where id = $1", [savedId.id]);
    assert.equal(still[0].body_html, published.bodyHtml);
  });
});
