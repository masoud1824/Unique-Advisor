#!/usr/bin/env node
/**
 * Create, back up, and restore a disposable PGLite database.
 * This is a sanitized fixture, not a backup of the acceptance desk.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { assertReleaseDatabase } from "../../src/lib/release-env.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = process.env.UA_RELEASE_DATA_ROOT || "/opt/ua-release/data";
const requestedEnv = process.env.UA_RELEASE_ENV || "development";
if (requestedEnv !== "development" && requestedEnv !== "staging") {
  throw new Error("Disposable database accepts only development or staging.");
}
process.env.UA_RELEASE_ENV = requestedEnv;
process.env.UA_RELEASE_DATA_ROOT = dataRoot;
delete process.env.DATABASE_URL;

const dbName = process.env.UA_RELEASE_DB_NAME || (requestedEnv === "staging" ? "staging" : "dev");
if (!/^[a-z][a-z0-9-]{0,30}$/.test(dbName)) {
  throw new Error(`Refusing database name ${dbName}.`);
}
const sourceDir = resolve(dataRoot, dbName);
const restoreDir = resolve(dataRoot, dbName === "dev" ? "restore-check" : `${dbName}-restore-check`);
const dumpPath = dbName === "dev"
  ? "/opt/ua-release/artifacts/sanitized-fixture-backup.tar.gz"
  : `/opt/ua-release/artifacts/sanitized-fixture-backup-${dbName}.tar.gz`;

assertReleaseDatabase(sourceDir);
assertReleaseDatabase(restoreDir);

const fixture = JSON.parse(await readFile(join(root, "fixtures/sanitized-practice.fixture.json"), "utf8"));
if (fixture.kind !== "sanitized-test-fixture" || fixture.notADatabaseBackup !== true) {
  throw new Error("Refusing to load a file that is not marked as a sanitized fixture.");
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

async function seed(pg) {
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
  await pg.query(
    "insert into advisors (slug, practice_name, advisor_name) values ('release-fixture', 'Fictional Practice', 'Fixture Advisor')",
  );
  const advisor = await pg.query("select id from advisors where slug = 'release-fixture'");
  const advisorId = advisor.rows[0].id;
  for (const contact of fixture.contacts) {
    await pg.query(
      "insert into contacts (advisor_id, full_name, email, phone, tags) values ($1, $2, $3, '', $4)",
      [advisorId, contact.name, contact.email, contact.tags],
    );
  }
  await pg.query(
    "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3)",
    [advisorId, fixture.letter.title, fixture.letter.body],
  );
  await pg.query(
    "insert into drip_campaigns (advisor_id, name, steps, every_days, active, design) values ($1, $2, $3, $4, false, 'plum')",
    [advisorId, fixture.drip.name, JSON.stringify(fixture.drip.steps.map((step, index) => ({ ...step, waitDays: index === 1 ? fixture.drip.step2WaitDays : 0 }))), fixture.drip.everyDays],
  );
  return advisorId;
}

async function readBack(pg) {
  const contacts = await pg.query("select full_name, email, tags from contacts order by full_name");
  const letter = await pg.query("select title, body from saved_letters");
  const drip = await pg.query("select name, steps, every_days, active from drip_campaigns");
  const migrations = await pg.query("select count(*)::int as n from _migrations");
  return {
    contacts: contacts.rows.length,
    letter: letter.rows[0]?.body,
    dripActive: drip.rows[0]?.active,
    everyDays: Number(drip.rows[0]?.every_days),
    steps: JSON.parse(drip.rows[0]?.steps || "[]"),
    migrations: migrations.rows[0].n,
  };
}

if (existsSync(sourceDir)) await rm(sourceDir, { recursive: true, force: true });
await mkdir(sourceDir, { recursive: true });
const created = new PGlite(sourceDir);
await created.waitReady;
const migrationCount = await applyMigrations(created);
await seed(created);
const before = await readBack(created);
const dump = await created.dumpDataDir("gzip");
const dumpBytes = new Uint8Array(await dump.arrayBuffer());
await mkdir("/opt/ua-release/artifacts", { recursive: true });
await writeFile(dumpPath, dumpBytes);
await created.close();

if (existsSync(restoreDir)) await rm(restoreDir, { recursive: true, force: true });
await mkdir(restoreDir, { recursive: true });
const { execFileSync } = await import("node:child_process");
execFileSync("tar", ["-C", restoreDir, "-xzf", dumpPath], { stdio: "inherit" });
const restored = new PGlite(restoreDir);
await restored.waitReady;
const after = await readBack(restored);
await restored.close();

const report = {
  kind: "sanitized-fixture-restore",
  notADatabaseBackup: true,
  migrationCount,
  before,
  after,
  dumpPath,
  dumpBytes: dumpBytes.byteLength,
  letterMatches: before.letter === fixture.letter.body && after.letter === fixture.letter.body,
  contactsMatch: before.contacts === fixture.contacts.length && after.contacts === fixture.contacts.length,
  dripInactive: before.dripActive === false && after.dripActive === false,
  step2Wait: before.steps[1]?.waitDays === 3 && after.steps[1]?.waitDays === 3,
};
if (!report.letterMatches || !report.contactsMatch || !report.dripInactive || !report.step2Wait) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
