# Build and start, not deployed

`npm run build` in this copy only builds the application. It does not change a database.

`npm run db:migrate` applies `migrations/*.sql` with the `pg` driver when `DATABASE_URL` is set. It is a separate command. Do not point it at the acceptance database.

The production artifact is `.vercel/output`, Nitro preset `vercel`, Node 22. This copy does not deploy it.

## Local staging process

`scripts/release/run-staging.sh` starts one staging process. It refuses port 8080, binds `127.0.0.1:8093` only, and opens `PGLITE_DATA_DIR=/opt/ua-release/data/staging-review`. That directory is a fictional practice created by `scripts/release/seed-staging.mjs`. It is not a copy of the acceptance database.

The process writes its own pid to `/opt/ua-release/run/staging.pid` before it becomes the server. Stop it by signaling that pid only after the command line is this staging tree and port 8093. Do not scan or signal other processes.

Birthday automation stays off. `UA_OUTBOUND_BLOCK=1` and `UA_RELEASE_ENV=staging` block provider, mail, Dropbox, Zoom, and campaign writes. `UA_BIRTHDAY_LIVE` is not set.

The operator password and advisor access codes are written only to `/opt/ua-release/run/staging-access.txt` with mode 600. They are not in source, not in a URL, and they are not the acceptance desk credentials. The word `superadmin` is still rejected.

## Why this is not a website you can open

The preview proxy shows only whatever is served on `0.0.0.0:8080`. That address is the tested acceptance desk. This staging process listens on loopback port 8093, so it does not appear in that preview. Replacing port 8080 would take the tested desk off the screen. Do not do that.

Loopback is not a private website for the reviewer.

## Proposed private host, not provisioned

One later approval could host this staging copy. Nothing below is purchased, started, or published from here. There is still no address a reviewer can open.

| Piece | Proposal |
|---|---|
| Runtime | Node.js 22, the same major version this copy uses. One process, not shared with the tested desk. |
| Artifact | `npm run build` writes `.vercel/output` (Nitro, Vercel preset). Do not deploy that artifact until a separate approval. |
| Start | `UA_RELEASE_ENV=staging UA_OUTBOUND_BLOCK=1 UA_RELEASE_HOST=127.0.0.1 node scripts/with-app-env.mjs node_modules/vite/bin/vite.js dev` for a private review process, or the built Node server only after the host is approved. Port must not be 8080. |
| Database | A new empty database on that host. Today this code refuses `DATABASE_URL` while `UA_RELEASE_ENV` is `development` or `staging`, because that guard also blocks the tested desk. A managed Postgres database needs one reviewed change: allow a named staging URL that is not the acceptance database, and keep `UA_OUTBOUND_BLOCK=1`. Until that change, use a private PGLite directory on the host, created by `scripts/release/seed-staging.mjs`. |
| Access | Advisor code and superadmin password are environment secrets, mode 600, given out of band. The word `superadmin` stays rejected. No password in a URL. |
| Outbound | `UA_OUTBOUND_BLOCK=1`. No SMTP, Graph, Dropbox, Zoom, or campaign writes. `UA_BIRTHDAY_LIVE` unset. Birthday automation remains off. |
| Persistence | The host keeps its own database directory or its own managed database, plus the news and birthday rows. It does not share files with the tested desk. |
| Isolation | Own source checkout, own `npm ci`, own process id, own log, own database. Stop that process by its own pid only. |

Do not point any of this at `/workspace`, port 8080, or the acceptance database.

Birthday automation has no live timer here. `scripts/release/birthday-tick.mjs` plans with a fake clock and refuses a live run.

`scripts/release/export-acceptance.mjs` always refuses. A real backup still needs a maintenance window.
