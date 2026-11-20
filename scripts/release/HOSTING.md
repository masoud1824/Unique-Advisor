# Build and start, not deployed

`npm run build` in this copy only builds the application. It does not change a database.

`npm run db:migrate` applies `migrations/*.sql` with the `pg` driver when `DATABASE_URL` is set. It is a separate command. Do not point it at the acceptance database.

The production artifact is `.vercel/output`, Nitro preset `vercel`, Node 22. This copy does not deploy it.

An isolated local process, if you later approve one, must set `UA_RELEASE_ENV` to `development` or `staging`, a port other than 8080, and a database directory under `/opt/ua-release/data`. `scripts/release/start-isolated.sh` refuses port 8080 and the acceptance database paths. It was not started for this task, because the only screen you can open is the acceptance desk.

Birthday automation has no live timer here. `scripts/release/birthday-tick.mjs` plans with a fake clock and refuses a live run.

`scripts/release/export-acceptance.mjs` always refuses. A real backup still needs a maintenance window.
