# Staging startup and configuration

This is the combined staging site for `portability/vercel-neon`. It is a new empty host. It is not the published Unique Advisor site, not the frozen acceptance desk, and not a restore of either database. Do not point these steps at an existing production database or at port 8080.

## What you create

One Vercel project (Pro) and one empty PostgreSQL database used only by that project. Neon has no Canada region; a Postgres server in Canada can be substituted later because the app uses ordinary `pg`. Put the functions in Montréal (`yul1`), which `vercel.json` already requests. Pro is required for `yul1` and for the quarter-hour cron. Hobby will reject that cron.

Turn off automatic production promotion from git. A push of this branch must not migrate or deploy production. Do not merge this branch to `main`.

## Startup

1. Node 22. From this checkout: `npm ci`.
2. Copy `.env.example` to the host's environment. Set values only in the host. Do not commit them.
3. Create an empty database. Put the pooled URL in `DATABASE_URL` and the direct URL in `DATABASE_URL_UNPOOLED`. Both need `sslmode=require` on Neon.
4. Set `UA_DATA_PLANE=postgres`, `UA_HOST_ENV=staging`, `UA_RELEASE_ENV=staging`, `UA_OUTBOUND_BLOCK=1`. Leave `UA_JOBS_EXECUTE` unset. Leave `UA_MIGRATE_APPROVED` unset.
5. Migrate that empty database only: `npm run db:migrate` with `DATABASE_URL_UNPOOLED`. Do not set `DATABASE_URL` to the published database.
6. Seed fictional rows only, with `scripts/release/seed-staging.mjs`, after you have confirmed the database name is the new staging database.
7. Deploy the Vercel project from this branch. `npm run build` does not migrate.
8. Open `GET /api/health`. It should report the postgres data plane up, with no rows and no URLs.
9. Call `GET /api/jobs/tick` with a wrong secret and confirm 401. Call it with the real `CRON_SECRET` and confirm the JSON says outbound is blocked and `sent` is 0.

## Guards that must stay on

- `UA_OUTBOUND_BLOCK=1` and `UA_RELEASE_ENV=staging` keep mail, Dropbox Sign, and Dropbox upload from leaving the server.
- Setting `UA_JOBS_EXECUTE=1` on staging does not remove that block and does not approve a card.
- A birthday still requires the advisor's confirmed card version. A drip, reply check, or signature check uses only that advisor's stored connection. A missing connection is a blocked job, not a success.
- `UA_BUDGET_HALT`, `UA_BUDGET_HALT_MAIL`, and `UA_BUDGET_HALT_SIGNATURE` also stop provider calls.

## Callbacks to register on the staging domain

Register these on the new domain before connecting a fictional or later production account. They must be https and must match the request host. `http://localhost` is the only http exception.

- `/api/microsoft/callback` (or the exact value of `MICROSOFT_REDIRECT_URI` if you set it)
- `/api/google/callback`
- `/api/zoom/callback`
- `/api/box/callback`
- `/api/link/callback`
- `/api/dropbox-sign/event`

Zoom will not start until `PUBLIC_APP_URL` or `BETTER_AUTH_URL` is the staging `https` origin. Leave `GROK_AUTH_*` empty unless this environment has its own broker client. Do not set a cookie `Domain`.

## What you must supply

Names only. Do not paste values into git, chat, or the published project.

Services:
- One new Vercel project on Pro, not Hobby. Turn automatic production promotion off. Functions stay in Montréal (`yul1`). Do not reuse the published project.
- One new empty PostgreSQL database used only by that project. Neon has no Canada region. A Postgres server in Canada can replace it later. Do not paste the published connection string.
- One staging `https` domain on that project.

Environment names:
- `DATABASE_URL` — pooled URL, `sslmode=require`
- `DATABASE_URL_UNPOOLED` — direct URL, `sslmode=require`, used only to migrate
- `UA_DATA_PLANE` = `postgres`
- `UA_HOST_ENV` = `staging`
- `UA_RELEASE_ENV` = `staging`
- `UA_OUTBOUND_BLOCK` = `1`
- `CRON_SECRET` — 16 characters or more
- `PUBLIC_APP_URL` or `BETTER_AUTH_URL` — the staging `https` origin
- `BETTER_AUTH_SECRET`
- `PREVIEW_OPERATOR_PASSWORD` — fictional operator secret, not the word `superadmin`
- Leave `UA_JOBS_EXECUTE` unset. Leave `UA_MIGRATE_APPROVED` unset. Leave `UA_BIRTHDAY_LIVE` unset.
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_REDIRECT_URI` only if a mailbox will be connected later. They are not required while outbound is blocked.
- Per-advisor Microsoft, Dropbox, and Dropbox Sign tokens are stored in the staging database after a connection. They are not git values.

Callbacks on the staging `https` origin:
- `/api/microsoft/callback` (or `MICROSOFT_REDIRECT_URI` if you set it)
- `/api/google/callback`
- `/api/zoom/callback`
- `/api/box/callback`
- `/api/link/callback`
- `/api/dropbox-sign/event`

Expected cost, before tax, not an invoice: Vercel Pro is about $20 per user each month, with $20 of included usage. The quarter-hour cron is function time, not a second product. Neon Free is $0; Launch is usage with no monthly minimum (their intermittent example is about $15 a month). Confirm the current pricing pages before you create either account. OpenAI, Microsoft, and Dropbox Sign stay off the bill while `UA_OUTBOUND_BLOCK=1`.

## Later checks this code does not finish

Microphone permission, spoken playback, interruption, and a live Microsoft, Dropbox, or Dropbox Sign call are host checks. They start only after you have seen a blocked tick and you approve one exact preview on a host where outbound is allowed. They are not part of this branch.
