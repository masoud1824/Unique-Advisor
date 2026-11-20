import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { acceptStoredSession, deskSetCookie, DESK_STORAGE_KEY, hashDeskToken, readCookieToken, sessionStillValid, signedInFromCookie } from "./desk-session-check.ts";
import { deskDayWindow, msUntilZoneMidnight, onDeskDays } from "./meeting-time.ts";

const advisor = { id: 4, slug: "masoud", code_hash: "abc" };

describe("desk session", () => {
  it("stays valid until expiry and dies when the access code changes", () => {
    const later = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(sessionStillValid({ advisorId: 4, slug: "masoud", codeHash: "abc", expiresAt: later }, advisor), true);
    assert.equal(sessionStillValid({ advisorId: 4, slug: "masoud", codeHash: "old", expiresAt: later }, advisor), false);
    assert.equal(sessionStillValid({ advisorId: 4, slug: "masoud", codeHash: "abc", expiresAt: new Date(Date.now() - 1000).toISOString() }, advisor), false);
    assert.equal(sessionStillValid({ advisorId: 9, slug: "masoud", codeHash: "abc", expiresAt: later }, advisor), false);
  });

  it("unlock sets a host cookie, and a later request with only that cookie is signed in", () => {
    const token = "a".repeat(64);
    const header = deskSetCookie(token, { secure: true, domain: "youradviser.grok.me" });
    assert.match(header, /^ua_desk=[a-f0-9]{64}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax; Domain=youradviser\.grok\.me$/);
    assert.equal(header.includes("/_serverFn"), false);
    assert.equal(readCookieToken(header), token);
    const session = {
      advisorId: 4,
      slug: "masoud",
      codeHash: "abc",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    assert.equal(signedInFromCookie({ setCookie: header, advisor, session }), true);
    assert.equal(signedInFromCookie({ setCookie: "", advisor, session }), false);
  });

  it("accepts an existing token after a restart when the database rows remain", () => {
    const secret = "fixed-secret-from-settings";
    const token = "ab".repeat(32);
    const database = {
      secret,
      sessions: [{
        tokenHash: hashDeskToken(token, secret),
        advisorId: advisor.id,
        slug: advisor.slug,
        codeHash: advisor.code_hash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }],
    };
    const restartedSecret = database.secret;
    const restartedRows = database.sessions.map((row) => ({ ...row }));
    const session = acceptStoredSession(restartedRows, token, restartedSecret, advisor);
    assert.ok(session);
    assert.equal(session?.slug, "masoud");
    assert.equal(DESK_STORAGE_KEY, "ua-desk-session");
    assert.equal(acceptStoredSession(restartedRows, token, "regenerated-on-startup", advisor), null);
  });

  it("keeps the token when the database is closed and opened again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desk-session-"));
    const secret = "fixed-secret-from-settings";
    const token = "cd".repeat(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const schema = `
      create table if not exists desk_session_secret (id integer primary key, secret text not null);
      create table if not exists desk_sessions (
        token_hash text primary key,
        advisor_id integer not null,
        slug text not null,
        code_hash text not null,
        expires_at timestamptz not null
      );
    `;
    try {
      const first = new PGlite(dir);
      await first.exec(schema);
      await first.query("insert into desk_session_secret (id, secret) values ($1, $2)", [1, secret]);
      await first.query(
        "insert into desk_sessions (token_hash, advisor_id, slug, code_hash, expires_at) values ($1, $2, $3, $4, $5)",
        [hashDeskToken(token, secret), advisor.id, advisor.slug, advisor.code_hash, expiresAt],
      );
      await first.close();
      const second = new PGlite(dir);
      const saved = await second.query<{ secret: string }>("select secret from desk_session_secret where id = 1");
      const rows = await second.query<{ token_hash: string; advisor_id: number; slug: string; code_hash: string; expires_at: string }>(
        "select token_hash, advisor_id, slug, code_hash, expires_at from desk_sessions",
      );
      await second.close();
      const session = acceptStoredSession(
        rows.rows.map((row) => ({
          tokenHash: row.token_hash,
          advisorId: Number(row.advisor_id),
          slug: row.slug,
          codeHash: row.code_hash,
          expiresAt: new Date(row.expires_at).toISOString(),
        })),
        token,
        saved.rows[0]?.secret || "",
        advisor,
      );
      assert.ok(session);
      assert.equal(session?.advisorId, advisor.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("today and tomorrow", () => {
  const fridayNight = new Date("2026-11-07T03:00:00.000Z");

  it("keeps only the advisor's today and tomorrow, including earlier today", () => {
    const window = deskDayWindow(fridayNight, "America/Toronto");
    assert.equal(window.today, "2026-11-06");
    assert.equal(window.tomorrow, "2026-11-07");
    assert.equal(onDeskDays(new Date("2026-11-06T13:00:00.000Z"), fridayNight, "America/Toronto"), true);
    assert.equal(onDeskDays(new Date("2026-11-07T20:00:00.000Z"), fridayNight, "America/Toronto"), true);
    assert.equal(onDeskDays(new Date("2026-11-05T20:00:00.000Z"), fridayNight, "America/Toronto"), false);
    assert.equal(onDeskDays(new Date("2026-11-08T14:00:00.000Z"), fridayNight, "America/Toronto"), false);
  });

  it("uses the next calendar day across the daylight-saving change", () => {
    const saturdayLate = new Date("2026-03-08T04:00:00.000Z");
    const window = deskDayWindow(saturdayLate, "America/Toronto");
    assert.equal(window.today, "2026-03-07");
    assert.equal(window.tomorrow, "2026-03-08");
    assert.ok(msUntilZoneMidnight(saturdayLate, "America/Toronto") < 3 * 60 * 60 * 1000);
    assert.ok(msUntilZoneMidnight(saturdayLate, "America/Toronto") > 60 * 1000);
  });
});
