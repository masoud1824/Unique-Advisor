# Promotion and rollback

The working acceptance desk is the source and process already serving the retested Nov 19 desk. This repository does not replace it.

Prepared here, not enabled remotely:

- Local git tag `acceptance-20261119-2232` marks the extracted source archive.
- Branch `release/process` adds these checks. It is not pushed.
- `.github/workflows/validate.yml` is a file only. It is not installed on GitHub, has no credentials, and uses `workflow_dispatch` so a future copy would not deploy on push.
- No branch protection was changed.

A branch or a feature flag is not isolation. Development and staging need their own source directory, database directory, cache directory, and port. Port 8080 stays with the acceptance desk. `UA_RELEASE_ENV=development` or `staging` refuses the acceptance database paths, refuses `DATABASE_URL`, and blocks outbound mail, signatures, campaigns, bookings, and uploads through `externalSideEffectsBlocked()`.

Promotion, when separately approved:

1. Re-run `node scripts/release/validate.mjs` in the candidate copy.
2. Take a new source archive and, only in an approved window, a database dump.
3. Replace the acceptance source only after that check. Do not point the acceptance process at a development database.

Rollback limits:

- `scripts/release/rollback.sh` defaults to dry-run and refuses `/workspace`.
- Resetting code to the tag does not reverse a database migration.
- Restoring a database backup can lose writes made after the backup.
- There is no automatic production migration and no live deployment from this copy.
