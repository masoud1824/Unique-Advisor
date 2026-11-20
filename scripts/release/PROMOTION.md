# Promotion and rollback

The working acceptance desk is the source and process already serving the retested Nov 19 desk. This repository does not replace it.

| Role | Source | Database | Cache | Bind |
|---|---|---|---|---|
| Acceptance, frozen | `/workspace` | `/workspace/.preview-data/pglite-isolated-test-20261118` | workspace Vite cache | `0.0.0.0:8080` (the only public preview) |
| Development | `/opt/ua-release/repos/dev` | `/opt/ua-release/data/dev` | `/opt/ua-release/cache/dev` | `127.0.0.1:8092` |
| Staging | `/opt/ua-release/repos/staging` | `/opt/ua-release/data/staging` | `/opt/ua-release/cache/staging` | `127.0.0.1:8093` |

`node_modules` in both copies is a symlink to `/workspace/node_modules`. That shared store is not isolation. Source, database, cache, and port are separate. Do not run an install that changes the acceptance modules without approval. Builds must set `UA_RELEASE_CACHE` outside `node_modules`.

Prepared here, not enabled remotely:

- Local git tag `acceptance-20261119-2232` marks the extracted source archive.
- Branch `release/process` adds these checks. It is not pushed.
- `.github/workflows/validate.yml` is a file only. It is not installed on GitHub, has no credentials, and uses `workflow_dispatch` so a future copy would not deploy on push.
- No branch protection was changed.

A branch or a feature flag is not isolation. `UA_RELEASE_ENV=development` or `staging` refuses the acceptance database paths, refuses `DATABASE_URL`, and blocks outbound mail, signatures, campaigns, bookings, and uploads through `externalSideEffectsBlocked()`. This copy's dev server refuses port 8080.

Promotion, when separately approved:

1. Re-run `node scripts/release/validate.mjs` in the candidate copy.
2. Take a new source archive and, only in an approved window, a database dump.
3. Replace the acceptance source only after that check. Do not point the acceptance process at a development database.

Rollback limits:

- `scripts/release/rollback.sh` defaults to dry-run and refuses `/workspace`.
- Resetting code to the tag does not reverse a database migration.
- Restoring a database backup can lose writes made after the backup.
- There is no automatic production migration and no live deployment from this copy.
- Ports 8092 and 8093 are local only. The public preview cannot open them.
