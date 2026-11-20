import { pendingMigrations } from "../../scripts/migration-plan.mjs";
import { isolatedTestRequested, refusePreviewDataDir } from "@/lib/isolated-test-desk";

/** Which database backend is active. */
export type DbSource = "neon" | "pglite";

// An empty/whitespace DATABASE_URL (an easy misconfig in deploy UIs) must mean
// "unset" — otherwise production would silently run on the PGLite fallback.
const rawDatabaseUrl =
  typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;
const databaseUrl =
  rawDatabaseUrl && rawDatabaseUrl.trim() ? rawDatabaseUrl : undefined;

/**
 * Active backend: real **Neon** when `DATABASE_URL` is set (deployed / configured
 * sandbox), otherwise a local embedded **PGLite** (Postgres compiled to WASM) so
 * the app has a working database even with nothing configured — the live preview
 * included. Swap in Neon later by just setting `DATABASE_URL`; no code changes.
 */
export const dbSource: DbSource = databaseUrl ? "neon" : "pglite";

if (isolatedTestRequested() && databaseUrl) {
  throw new Error("Isolated test mode refuses a hosted database.");
}

/**
 * Minimal shared SQL surface, satisfied by both Neon and PGLite. Both the
 * tagged-template and `.query()` forms resolve to an array of row objects:
 *
 *   const sql = await getSql();
 *   const rows = await sql`select * from todos where id = ${id}`; // parameterized
 *   const rows2 = await sql.query("select * from todos where id = $1", [id]);
 */
export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

/**
 * Init state lives on globalThis as promises: dev HMR creates new instances of
 * this module, and two instances racing module-level state would open a second
 * pool or run two concurrent PGLite migration passes (whose duplicate
 * `_migrations` insert rejects — and would get memoized, poisoning every later
 * `getSql()`). A failed init clears its slot so the next call retries.
 */
const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
  __pgliteDataDir__?: string;
  __pgliteLock__?: PreviewLock;
};

type PreviewLock = {
  stdin: { end: () => void } | null;
  kill: () => boolean;
  exitCode: number | null;
  once: (event: "exit", fn: () => void) => void;
  removeAllListeners: (event: "exit") => void;
};

/**
 * PGLite writes a postmaster.pid whose pid is not a live process, so a second
 * Node process will open the same directory and tear the WAL. Hold an OS lock
 * on a sibling file for the life of this process. The lock is released when
 * the process exits. Never opens the data directory.
 */
async function acquirePreviewLock(dataDir: string): Promise<PreviewLock> {
  const { spawn } = await import("node:child_process");
  const lockPath = `${dataDir}.lock`;
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/flock", ["-n", "--", lockPath, "cat"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      child.stdin?.end();
      reject(new Error(message));
    };
    child.once("error", (err: Error) => fail(`Could not lock the preview database (${err.message}).`));
    child.once("exit", (code: number | null) =>
      fail(
        `Preview database is already open in another process. A second writer is refused so the log cannot tear (${lockPath}, exit ${code}).`,
      ),
    );
    setTimeout(() => {
      if (settled || child.exitCode != null) return;
      settled = true;
      child.removeAllListeners("exit");
      child.unref();
      resolve(child);
    }, 150);
  });
}

function releasePreviewLock(lock: PreviewLock | undefined) {
  if (!lock || lock.exitCode != null) return;
  lock.stdin?.end();
  const timer = setTimeout(() => lock.kill(), 200);
  lock.once("exit", () => clearTimeout(timer));
}

/** Preview-only file. Production uses Neon and never opens this directory. */
function previewDataDir(): string {
  const chosen = process.env.PGLITE_DATA_DIR?.trim() || "/workspace/.preview-data/pglite";
  return chosen === "memory" ? "" : chosen;
}

/**
 * Result-type parity: Postgres sends every value as text plus a type OID — the
 * JS value is the DRIVER's parsing choice, and pg and PGLite disagree (pg:
 * int8 -> string, date -> local-midnight Date; PGLite: int8 -> BigInt, which
 * JSON.stringify rejects, date -> UTC Date). Normalize both so preview and
 * production return identical, JSON-safe shapes:
 *   int8/bigint (incl. count(*)) -> number (past 2^53 loses precision — cast
 *                                   `::text` if you ever need huge integers)
 *   date                         -> 'YYYY-MM-DD' string
 *   interval                     -> Postgres interval text
 * numeric already comes back as a string on both (arbitrary precision).
 */
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

/** Wrap a query runner in the tagged-template + `.query()` `Sql` surface. */
function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    // Rebuild with $1, $2, … placeholders so values stay parameterized.
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

function createNeonSql(): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    // Regular Postgres driver: node-postgres (`pg`) — works directly with Neon's
    // pooled endpoint. One pool per process; warm serverless instances reuse it.
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    const pool = new Pool({ connectionString: databaseUrl });
    return toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}

async function createPgliteSql(): Promise<Sql> {
  // File-backed only when no DATABASE_URL is set. The directory is outside
  // production and is not copied from Neon. An existing in-memory instance is
  // closed once so the process switches onto that file.
  const wanted = previewDataDir();
  const refused = refusePreviewDataDir(wanted);
  if (refused) throw new Error(refused);
  if (globalRef.__pgliteInstance__ && (globalRef.__pgliteDataDir__ || "") !== wanted) {
    const previous = globalRef.__pgliteInstance__;
    const previousLock = globalRef.__pgliteLock__;
    globalRef.__pgliteInstance__ = undefined;
    globalRef.__pgliteLock__ = undefined;
    try {
      const pg = await previous;
      await pg.close();
    } catch {
      // The previous opener failed or is already closed.
    }
    releasePreviewLock(previousLock);
  }
  globalRef.__pgliteDataDir__ = wanted;
  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    let lock: PreviewLock | undefined;
    try {
      if (wanted) {
        // Sibling lock only. Do not open the data directory until this succeeds.
        lock = await acquirePreviewLock(wanted);
        globalRef.__pgliteLock__ = lock;
        const { mkdirSync } = await import("node:fs");
        mkdirSync(wanted, { recursive: true, mode: 0o700 });
      }
      const pg = new PGlite(wanted || "memory://", {
        parsers: {
          [OID_INT8]: Number,
          [OID_DATE]: identity,
          [OID_INTERVAL]: identity,
        },
      });
      await pg.waitReady;
      await pg.exec(
        "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
      );
      if (wanted) {
        await pg.exec(
          "create table if not exists _preview_store (id integer primary key, marker text not null, created_at timestamptz not null default now())",
        );
        await pg.query(
          "insert into _preview_store (id, marker) values (1, 'preview-disk') on conflict (id) do nothing",
        );
      }
      return pg;
    } catch (err) {
      releasePreviewLock(lock);
      if (globalRef.__pgliteLock__ === lock) globalRef.__pgliteLock__ = undefined;
      throw err;
    }
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  // Apply migrations/ (the single schema source) so preview matches production.
  // SQL is inlined by the bundler via import.meta.glob (no runtime fs); applied
  // files are tracked in _migrations. The glob does not descend, so the opt-in
  // auth schema under migrations/auth/ stays out. A reload after the site content
  // column applies it live, with passes serialized so callers never double-apply.
  const migrate = async (): Promise<void> => {
    const migrations = import.meta.glob("/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const doneRows = await pg.query<{ name: string }>(
      "select name from _migrations",
    );
    const done = doneRows.rows.map((r) => r.name);
    for (const { name, path } of pendingMigrations(Object.keys(migrations), done)) {
      // Apply + record atomically (parity with scripts/migrate.mjs) so a failed
      // statement can't leave a file half-applied but untracked.
      await pg.transaction(async (tx) => {
        await tx.exec(migrations[path]);
        await tx.query("insert into _migrations (name) values ($1)", [name]);
      });
    }
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined) // an earlier failed pass must not wedge the chain
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return toSql(async <T>(text: string, params: unknown[]) => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  });
}

let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  return dbSource === "neon" ? createNeonSql() : createPgliteSql();
}

/**
 * Get the shared, **server-only** SQL client. Neon when `DATABASE_URL` is set,
 * otherwise the local PGLite fallback. Memoized — safe to call per request.
 *
 * Schema comes from `migrations/*.sql`, auto-applied before the first query on
 * both backends — define tables there, never inline in server functions.
 */
export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch((err) => {
    sqlPromise = null; // don't memoize failures — let the next call retry
    throw err;
  });
  return sqlPromise;
}

/**
 * The shared PGLite instance (preview only), with `migrations/*.sql` applied.
 * Lets Better Auth persist to the SAME embedded DB as app data in preview (via a
 * Kysely dialect). Throws when `DATABASE_URL` is set (that path uses Neon).
 */
export async function getPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  if (dbSource !== "pglite") {
    throw new Error("getPglite() is only available on the PGLite fallback (no DATABASE_URL)");
  }
  await getSql();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  return pg;
}

/**
 * Finish DB bootstrap before the server handles traffic.
 *
 * - **PGLite** (preview / no `DATABASE_URL`): open the preview file database and
 *   apply `migrations/*.sql`. Idempotent — concurrent callers share one promise.
 * - **Neon**: no-op (pool is created lazily on first query).
 *
 * Vite `configureServer` awaits this at dev startup; production imports of this
 * module kick it off immediately (see bottom of file).
 */
export function ensureDbReady(): Promise<void> {
  if (dbSource !== "pglite") return Promise.resolve();
  return getSql().then(() => undefined);
}

const globalShutdown = globalThis as typeof globalThis & { __pgliteShutdownHook__?: boolean };
if (typeof window === "undefined" && !globalShutdown.__pgliteShutdownHook__) {
  globalShutdown.__pgliteShutdownHook__ = true;
  const closePreviewDatabase = () => {
    void (async () => {
      try {
        const pending = globalRef.__pgliteInstance__;
        if (pending) await (await pending).close();
      } catch {
        /* The process is leaving. A failed close must not keep the lock. */
      }
      releasePreviewLock(globalRef.__pgliteLock__);
      process.exit(0);
    })();
  };
  process.once("SIGTERM", closePreviewDatabase);
  process.once("SIGINT", closePreviewDatabase);
}

// Server-only eager start: kick PGLite bootstrap as soon as this module loads in
// Node. Client bundles never hit this path (`getSql` throws in the browser).
const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};
if (typeof window === "undefined" && dbSource === "pglite") {
  globalBoot.__pgBootstrapPromise__ ??= ensureDbReady().catch((err) => {
    globalBoot.__pgBootstrapPromise__ = undefined;
    console.error("[db] PGLite bootstrap failed:", err);
    throw err;
  });
}
