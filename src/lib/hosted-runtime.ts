/**
 * Hosted-runtime decisions. Kept in TypeScript so the desk does not import an untyped script.
 * scripts/hosted-guard.mjs is the same policy for the migrator; both are tested.
 */

export function hostedDataPlane() {
  return process.env.UA_DATA_PLANE === "postgres";
}

export function migrationDatabaseUrl() {
  return process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim() || "";
}

export function migrationApproved() {
  if (process.env.UA_HOST_ENV !== "production") return true;
  return process.env.UA_MIGRATE_APPROVED === "1";
}

export function cronAuthorized(header: string | null) {
  const secret = process.env.CRON_SECRET?.trim() || "";
  if (secret.length < 16) return false;
  const expected = `Bearer ${secret}`;
  const given = String(header || "");
  if (given.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return mismatch === 0;
}

export function redactPrivate(text: string) {
  return String(text || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(sk|gh[pousr]|xox[baprs])-[A-Za-z0-9_-]{8,}\b/g, "[secret]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
}

export function neonPoolConfig(connectionString: string) {
  const hosted = hostedDataPlane() || process.env.VERCEL === "1";
  const config: {
    connectionString: string;
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
    ssl?: { rejectUnauthorized: boolean };
  } = {
    connectionString,
    max: hosted ? 1 : 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };
  if (/sslmode=require/i.test(connectionString)) config.ssl = { rejectUnauthorized: true };
  return config;
}

export function budgetOpen(kind: "openai" | "mail" | "signature") {
  if (process.env.UA_BUDGET_HALT === "1") return false;
  if (kind === "openai" && process.env.UA_BUDGET_HALT_OPENAI === "1") return false;
  if (kind === "mail" && process.env.UA_BUDGET_HALT_MAIL === "1") return false;
  if (kind === "signature" && process.env.UA_BUDGET_HALT_SIGNATURE === "1") return false;
  return true;
}

export function assertHostedDatabaseConfigured() {
  if (!hostedDataPlane()) return;
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("UA_DATA_PLANE=postgres requires DATABASE_URL. Local PGLite is not used for hosted data.");
  }
}
