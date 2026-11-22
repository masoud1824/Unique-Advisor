/**
 * Plain-JS host rules shared by the migrator and the disposable Postgres rehearsal.
 * The desk copy in src/lib/hosted-runtime.ts must keep the same decisions.
 * No secrets belong in this file.
 */

export function hostedDataPlane() {
  return process.env.UA_DATA_PLANE === "postgres";
}

export function migrationDatabaseUrl() {
  return process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim() || "";
}

/** Production schema changes are explicit. Every other host env may migrate its own database. */
export function migrationApproved() {
  if (process.env.UA_HOST_ENV !== "production") return true;
  return process.env.UA_MIGRATE_APPROVED === "1";
}

export function cronAuthorized(header) {
  const secret = process.env.CRON_SECRET?.trim() || "";
  if (secret.length < 16) return false;
  const expected = `Bearer ${secret}`;
  const given = String(header || "");
  if (given.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return mismatch === 0;
}

export function redactPrivate(text) {
  return String(text || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(sk|gh[pousr]|xox[baprs])-[A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
}

export function neonPoolConfig(connectionString) {
  const hosted = hostedDataPlane() || process.env.VERCEL === "1";
  const config = {
    connectionString,
    max: hosted ? 1 : 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };
  if (/sslmode=require/i.test(connectionString)) config.ssl = { rejectUnauthorized: true };
  return config;
}

export function budgetOpen(kind) {
  if (process.env.UA_BUDGET_HALT === "1") return false;
  if (kind === "openai" && process.env.UA_BUDGET_HALT_OPENAI === "1") return false;
  if (kind === "mail" && process.env.UA_BUDGET_HALT_MAIL === "1") return false;
  if (kind === "signature" && process.env.UA_BUDGET_HALT_SIGNATURE === "1") return false;
  return true;
}

/** Local rehearsal only. Refuses Neon, the acceptance tree, and any non-loopback host. */
export function assertDisposablePostgresUrl(url) {
  if (process.env.UA_DISPOSABLE_POSTGRES !== "1") {
    throw new Error("Disposable Postgres rehearsal requires UA_DISPOSABLE_POSTGRES=1.");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Disposable Postgres URL is not a URL.");
  }
  const host = parsed.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Disposable Postgres rehearsal refuses any host except loopback.");
  }
  if (/neon\.tech|grok\.me|acceptance/i.test(url)) {
    throw new Error("Disposable Postgres rehearsal refuses that database.");
  }
  const name = parsed.pathname.replace(/^\//, "");
  if (!name.startsWith("ua_disposable")) {
    throw new Error("Disposable database name must start with ua_disposable.");
  }
}

/**
 * Staging seed target. Disposable mode stays on loopback.
 * A real staging seed must name the database staging and keep outbound closed.
 * The URL is not returned and must not be logged.
 */
export function assertHostedSeedTarget(url) {
  if (process.env.UA_DISPOSABLE_POSTGRES === "1") {
    assertDisposablePostgresUrl(url);
    return "disposable";
  }
  if (process.env.UA_HOSTED_SEED !== "yes") throw new Error("Hosted seed requires UA_HOSTED_SEED=yes.");
  if (process.env.UA_HOST_ENV !== "staging") throw new Error("Hosted seed requires UA_HOST_ENV=staging.");
  if (process.env.UA_RELEASE_ENV !== "staging") throw new Error("Hosted seed requires UA_RELEASE_ENV=staging.");
  if (process.env.UA_OUTBOUND_BLOCK !== "1") throw new Error("Hosted seed requires UA_OUTBOUND_BLOCK=1.");
  if (process.env.UA_MIGRATE_APPROVED === "1") throw new Error("Hosted seed refuses an approved production migration flag.");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Hosted seed URL is not a URL.");
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("?")[0]);
  if (!name || !/staging/i.test(name)) throw new Error("Hosted seed database name must include staging.");
  if (/production|acceptance|live/i.test(name)) throw new Error("Hosted seed refuses that database name.");
  if (/grok\.me/i.test(url)) throw new Error("Hosted seed refuses that database.");
  const remote = parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost";
  if (remote && !/sslmode=require/i.test(url)) throw new Error("Hosted seed requires sslmode=require.");
  return "staging";
}
