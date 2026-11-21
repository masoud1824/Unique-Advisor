#!/usr/bin/env node
/**
 * Upgrade a disposable copy from the acceptance baseline (0002–0027)
 * through the release migrations. Proves message_id exists before it is selected.
 * Never opens the acceptance database.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = process.env.UA_RELEASE_DATA_ROOT || "/opt/ua-release/data";
const forbidden = [
  "/workspace/.preview-data",
  "/workspace",
];
if (!dataRoot.startsWith("/opt/ua-release/data")) {
  throw new Error(`Schema upgrade refuses data root ${dataRoot}.`);
}
for (const blocked of forbidden) {
  if (dataRoot === blocked || dataRoot.startsWith(`${blocked}/`)) {
    throw new Error(`Schema upgrade refuses ${dataRoot}.`);
  }
}

const dir = await mkdtemp(join(dataRoot, "schema-upgrade-"));
const pg = new PGlite(dir);
await pg.waitReady;

async function files() {
  const names = (await readdir(join(root, "migrations"))).filter((name) => /^\d+.+\.sql$/.test(name)).sort();
  return names;
}

async function apply(names) {
  await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const name of names) {
    const text = await readFile(join(root, "migrations", name), "utf8");
    await pg.exec("begin");
    try {
      await pg.exec(text);
      await pg.query("insert into _migrations (name) values ($1) on conflict (name) do nothing", [name]);
      await pg.exec("commit");
    } catch (error) {
      await pg.exec("rollback");
      throw error;
    }
  }
}

const names = await files();
const baseline = names.filter((name) => name <= "0027_delivery_claims.sql" || name.startsWith("0027"));
const later = names.filter((name) => !baseline.includes(name));
if (!baseline.some((name) => name.startsWith("0023")) || !later.some((name) => name.startsWith("0033"))) {
  throw new Error(`Expected baseline 0023 and release 0033. Saw ${names.join(", ")}.`);
}
await apply(baseline);
let missingBefore = false;
try {
  await pg.query("select message_id from assistant_actions");
} catch (error) {
  missingBefore = /message_id/.test(String(error?.message || error));
}
if (!missingBefore) throw new Error("message_id was selectable before the release migration.");
await apply(later);
const selected = await pg.query("select message_id, chat_id from assistant_actions");
if (!Array.isArray(selected.rows)) throw new Error("message_id select did not return rows.");
const recorded = await pg.query("select name from _migrations order by name");
const recordedNames = recorded.rows.map((row) => row.name);
if (!recordedNames.includes("0033_action_message.sql")) throw new Error("0033 was not recorded.");
console.log(JSON.stringify({
  ok: true,
  directory: dir,
  baseline: baseline.length,
  later: later.length,
  messageIdSelectableAfterUpgrade: true,
  messageIdMissingOnBaseline: true,
  migrations: recordedNames,
}));
await pg.close();
await rm(dir, { recursive: true, force: true });
