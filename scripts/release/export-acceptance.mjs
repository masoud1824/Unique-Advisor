#!/usr/bin/env node
/**
 * This file does not export the acceptance database.
 * A consistent PGLite dump can be made only inside the process that already
 * has that database open. This authorization does not include stopping,
 * restarting, or editing that desk.
 */
console.error([
  "Refusing to export the acceptance database.",
  "Approval still required, in a maintenance window you choose:",
  "1. Stop new writes on the acceptance desk.",
  "2. From that same process, call dumpDataDir('gzip') and write the archive outside the data directory.",
  "3. Redact provider tokens before any development copy.",
  "4. Restore only into a new directory. Never extract over the acceptance directory.",
  "Do not copy the live data directory while it is open.",
].join("\n"));
process.exit(2);
