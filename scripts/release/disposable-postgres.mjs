#!/usr/bin/env node
/**
 * Fresh-database proof on a disposable local PostgreSQL server.
 * Refuses Neon, the acceptance database, and any non-loopback host.
 * This does not recover or read the published database.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertDisposablePostgresUrl } from "../hosted-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const databaseUrl = process.env.DATABASE_URL?.trim() || "";
assertDisposablePostgresUrl(databaseUrl);
const restoreUrl = process.env.DISPOSABLE_RESTORE_URL?.trim() || "";
assertDisposablePostgresUrl(restoreUrl);
if (restoreUrl === databaseUrl) throw new Error("Restore database must be a second disposable database.");

function run(command, args, env = {}) {
  const child = spawnSync(command, args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  if (child.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${(child.stderr || child.stdout || "").slice(0, 500)}`);
  }
  return child.stdout || "";
}

run(process.execPath, ["scripts/migrate.mjs"], {
  DATABASE_URL: databaseUrl,
  DATABASE_URL_UNPOOLED: databaseUrl,
  UA_HOST_ENV: "development",
  UA_MIGRATE_APPROVED: "",
  UA_DISPOSABLE_POSTGRES: "1",
});

const source = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await source.connect();
try {
  const applied = await client.query("select count(*)::int as n from _migrations");
  if (Number(applied.rows[0].n) < 30) throw new Error(`Expected the numbered migrations. Saw ${applied.rows[0].n}.`);
  await client.query(
    "insert into operators (id, code_hash) values (1, $1) on conflict (id) do nothing",
    ["not-a-password"],
  );
  await client.query(
    `insert into advisors (slug, practice_name, advisor_name, email, code_hash, status)
     values ($1, $2, $3, $4, $5, 'active')`,
    ["fictional-practice", "Fictional Practice", "Fictional Advisor", "desk@example.invalid", "not-a-code"],
  );
  const advisor = await client.query("select id from advisors where slug = $1", ["fictional-practice"]);
  await client.query(
    "insert into contacts (advisor_id, full_name, email, tags) values ($1, $2, $3, $4)",
    [advisor.rows[0].id, "Casey Sample", "casey.sample@example.invalid", "Fictional"],
  );
  await client.query(
    "insert into hosted_job_runs (run_key, kind, slot, status, detail) values ($1, 'tick', $2, 'planned', 'rehearsal')",
    ["tick:rehearsal", "rehearsal"],
  );
} finally {
  client.release();
  await source.end();
}

const dumpDir = mkdtempSync(join(tmpdir(), "ua-disposable-dump-"));
const dumpFile = join(dumpDir, "dump.sql");
run("pg_dump", ["--no-owner", "--no-privileges", "--format=plain", "--file", dumpFile, databaseUrl]);
const dump = readFileSync(dumpFile, "utf8").replace(/^SET transaction_timeout = .*;\r?\n/gm, "");
writeFileSync(dumpFile, dump);
if (/sk-|BEGIN OPENAI|masoudz@outlook|info@zangenehlaw/i.test(dump)) {
  throw new Error("Disposable dump contained a forbidden secret or mailbox.");
}
run("psql", [restoreUrl, "-v", "ON_ERROR_STOP=1", "-f", dumpFile]);

const restored = new pg.Pool({ connectionString: restoreUrl, max: 1 });
try {
  const row = await restored.query(
    "select full_name, email from contacts where email = $1",
    ["casey.sample@example.invalid"],
  );
  if (row.rows[0]?.full_name !== "Casey Sample") throw new Error("Restore did not return the fictional contact.");
  const job = await restored.query("select status from hosted_job_runs where run_key = $1", ["tick:rehearsal"]);
  if (job.rows[0]?.status !== "planned") throw new Error("Restore did not return the job row.");
  const ledger = await restored.query("select name from _migrations where name = '0034_hosted_jobs.sql'");
  if (!ledger.rows[0]) throw new Error("0034 was not in the restored migration ledger.");
} finally {
  await restored.end();
  rmSync(dumpDir, { recursive: true, force: true });
}
console.log("disposable-postgres: migrate, fictional row, dump, and restore matched. Nothing remote was used.");
