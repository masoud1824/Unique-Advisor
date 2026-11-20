#!/usr/bin/env node
/** Single validation command for the release copy. A nonzero child exit fails this process. */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReleaseProcess } from "../../src/lib/release-env.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env.UA_RELEASE_PORT || 8092);
assertReleaseProcess({ cwd: root, port });
if (process.env.DATABASE_URL?.trim()) {
  console.error("Refusing validation while DATABASE_URL is set.");
  process.exit(2);
}

const tests = [
  "src/lib/routing-repair.test.ts",
  "src/lib/explicit-routing.test.ts",
  "src/lib/handler-safeguards.test.ts",
  "src/lib/advisor-intent.test.ts",
  "src/lib/workflow-repair.test.ts",
  "src/lib/release-env.test.ts",
  "src/lib/isolated-test-desk.test.ts",
  "src/lib/workspace-policy.test.ts",
  "src/lib/workflow-entry.test.ts",
  "src/lib/delivery-safeguards.test.ts",
];

function run(label, command, args, env = {}) {
  console.log(`\n# ${label}`);
  console.log(`$ ${command} ${args.join(" ")}`);
  const child = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env, DATABASE_URL: "" },
  });
  const code = child.status ?? 1;
  console.log(`# ${label} exit ${code}`);
  if (code !== 0) process.exit(code);
}

run(
  "regression",
  "node",
  ["--experimental-strip-types", "--test", ...tests],
);
run("disposable-database", "node", ["--experimental-strip-types", "scripts/release/disposable-db.mjs"], {
  UA_RELEASE_ENV: "development",
  UA_RELEASE_DATA_ROOT: process.env.UA_RELEASE_DATA_ROOT || "/opt/ua-release/data",
});
if (process.env.UA_RELEASE_SKIP_BUILD === "1") {
  console.log("# build skipped by UA_RELEASE_SKIP_BUILD");
  process.exit(0);
}
run(
  "production-build",
  "node",
  ["scripts/with-app-env.mjs", "node_modules/vite/bin/vite.js", "build"],
  {
    DATABASE_URL: "",
    UA_RELEASE_CACHE: process.env.UA_RELEASE_CACHE || "/opt/ua-release/cache/dev",
  },
);
console.log("# validate exit 0");
