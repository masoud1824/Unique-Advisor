# Acceptance database export — not approved to run

The acceptance desk keeps its database open in-process with PGLite (`@electric-sql/pglite`). The owner process holds an exclusive `flock` on `pglite-isolated-test-20261118.lock`. The application refuses a second opener because opening the same directory tears the write-ahead log.

`PGlite.dumpDataDir()` is the engine's consistent online backup, but only the process that already has the database open can call it. This desk does not expose that call. There is no Postgres wire port.

Do not:

- copy the live data directory
- kill the owner to unlock it
- weaken the lock
- edit the live acceptance source to add an exporter
- open `pglite-untouched-20261119`, `pglite`, or `pglite-work`

Approved maintenance, later and separately:

1. Stop new writes on the acceptance desk during a window you choose.
2. From that same owner process, call `dumpDataDir("gzip")` and write the archive outside the data directory.
3. Redact provider tokens before any development copy is made.
4. Restore only into a new directory. Never extract over the acceptance directory.
5. Compare schema, row counts, and the protected drafts, then restart the desk from the unchanged source.

Until that window exists, development uses `fixtures/sanitized-practice.fixture.json`. That file is a sanitized fixture, not a recoverable backup of the acceptance database.

The disposable proof is `node --experimental-strip-types scripts/release/disposable-db.mjs`. It creates `/opt/ua-release/data/dev`, dumps it, and restores into `/opt/ua-release/data/restore-check`.
