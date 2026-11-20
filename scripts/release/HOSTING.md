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

## Proposed hosting, not done

A later approval would need all of the following. None of it is provisioned here.

- A separate host and hostname. Not this preview, and not port 8080.
- Its own Node 22 install and its own `npm ci` from this lockfile. Do not share `node_modules` with the acceptance desk.
- A new empty database. Apply `npm run db:migrate`, then load only the fictional seed. Never point it at the acceptance data directory and never restore the acceptance database into it.
- This release code refuses `DATABASE_URL` while `UA_RELEASE_ENV` is `development` or `staging`. A managed Postgres staging site therefore needs a reviewed code change before it can use a hosted database. Until that review, the safe database is a private PGLite directory on that host.
- Keep `UA_OUTBOUND_BLOCK=1` until a separate approval to send anything. Leave birthday automation off.
- Give the advisor code and the superadmin password out of band. Do not put either in a URL.
- Keep the amber staging banner so the screen cannot be mistaken for the tested desk.

Birthday automation has no live timer here. `scripts/release/birthday-tick.mjs` plans with a fake clock and refuses a live run.

`scripts/release/export-acceptance.mjs` always refuses. A real backup still needs a maintenance window.
