# Independent hosting

This branch prepares a **new empty** Vercel + PostgreSQL environment. It is not a backup or a recovery of the published Unique Advisor database, and it does not attach to that database. The published site, the frozen acceptance desk, and every existing database stay untouched. Do not create accounts from this file until the costs and the Canada limitation below are accepted.

`release/combined-desk-review` stays as the code backup. This branch is `portability/vercel-neon`. Do not merge it to `main`.

## What runs

- Node 22, Vite 8, React 19, TanStack Start 1.169.4, Nitro preset `vercel`.
- Server entry is the Nitro output `.vercel/output` (`config.json` routes every path to `__server`). `npm run build` writes that output and does **not** migrate.
- Runtime SQL is `pg` when `DATABASE_URL` is set. `UA_DATA_PLANE=postgres` refuses the local PGLite fallback.
- Use Neon’s **pooled** URL as `DATABASE_URL` (`-pooler` in the host, `sslmode=require`). The pool in this app opens at most one connection per instance. Use the **direct** URL as `DATABASE_URL_UNPOOLED` for migrate, `pg_dump`, and `pg_restore`. See [Neon pooling](https://neon.com/docs/connect/connection-pooling) and [Neon on Vercel](https://neon.com/docs/connect/choose-connection).
- PDF work uses `pdf-lib` and `pdfjs-dist` in function memory. Signed files are stored in the advisor’s Dropbox, Box, Google Drive, or OneDrive, not on the function disk. Card text and newsletter payloads are rows in Postgres. Vercel’s disk is ephemeral and is not a database.

## Three environments

Use three Vercel projects and three databases. Do not copy production contacts or tokens into development or staging. There is no automatic promotion.

| Environment | `UA_HOST_ENV` | Database | Outbound |
| --- | --- | --- | --- |
| Development | `development` | local disposable Postgres, or PGLite only when `UA_DATA_PLANE` is unset | `UA_OUTBOUND_BLOCK=1` |
| Staging | `staging` | its own empty database, fictional rows only | `UA_OUTBOUND_BLOCK=1` |
| Production | `production` | its own empty database, after a reviewed migrate | block off only when a named preview is approved |

Staging is the one combined website for acceptance. Turn off Vercel auto-deploy to production. A push must not migrate production. Production migrate runs only as `UA_HOST_ENV=production UA_MIGRATE_APPROVED=1 npm run db:migrate` against `DATABASE_URL_UNPOOLED`, after the regression check passes.

## Jobs while the desk is closed

Birthday planning, drip due times, reply checks, and signature follow-up must not depend on `setInterval` inside a web process. On `UA_DATA_PLANE=postgres` those in-process timers do not start.

Vercel Cron calls `GET /api/jobs/tick` every hour (`0 * * * *`). Vercel sends `Authorization: Bearer` from `CRON_SECRET` (16 characters or more). A wrong or missing secret gets 401. The hour is stored in `hosted_job_runs` (`tick:YYYY-MM-DDTHH`). A second call in that hour does not send again.

The advisor-local 9:00 window, including daylight saving, is `America/Toronto` 14:00 UTC in January and 13:00 UTC in July. An hourly Pro cron hits both. A late same-day catch-up still runs until 15:00 local. Hobby cron is once a day and can land any time inside the hour, so it cannot keep the 9:00 promise. Cron pricing and limits: [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing). Cron authentication: [Manage Cron Jobs](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs). Cron runs only on that project’s production deployment, which is why staging must be its own project.

`UA_JOBS_EXECUTE` does **not** send mail in this build. The tick records due birthday, drip, and signature counts and returns `sent: 0`. Birthday retries stay in `birthday_claims`. Signature callbacks are inbound `POST /api/dropbox-sign/event`, verified with the advisor’s key, and duplicate events are ignored by the primary key. Reply notices stay deduped by message id. No extra queue product is required for this volume. If one tick ever needs longer than the function limit, use [Vercel Workflows](https://vercel.com/docs/workflows) later. Do not add a timer inside a request. Function limits: [Vercel Functions](https://vercel.com/docs/functions/limitations).

## Auth, callbacks, voice

- Set `PUBLIC_APP_URL` or `BETTER_AUTH_URL` to that environment’s `https` origin. The session cookie is `__Host-` (Secure, no Domain).
- Hosted mode does not fall back to the shared Grok preview OAuth client. Leave `GROK_AUTH_*` empty unless that environment has its own broker client. The advisor desk still uses its access code.
- Register these paths on the **new** domain at each provider before connecting an account: `/api/microsoft/callback`, `/api/google/callback`, `/api/zoom/callback`, `/api/box/callback`, `/api/link/callback`, `/api/dropbox-sign/event`. The desk builds the redirect from the browser origin.
- Voice is browser `MediaRecorder` plus the Web Speech API, then `POST /api/assistant/voice`. The reply is server-sent `text/event-stream` audio, not a WebSocket. Microphone, spoken audio, interruption, and live providers are not tested here.

## Secrets, health, logs, budget

Names live in `.env.example`. Values do not go in GitHub. `GET /api/health` returns `ok`, the data plane, and `up` or `down`. It does not return rows or URLs. Log lines from the health and job paths pass through redaction for URLs, bearer tokens, and mailbox addresses.

Before any paid project exists, set a Vercel spend limit and a Neon usage limit. `UA_BUDGET_HALT=1` makes the job tick record `budget-halt` and send nothing. `UA_BUDGET_HALT_OPENAI`, `UA_BUDGET_HALT_MAIL`, and `UA_BUDGET_HALT_SIGNATURE` are the narrower switches.

## Migrate, backup, rollback

1. Create an empty database. Do not paste the published connection string.
2. `npm run db:migrate` with `DATABASE_URL_UNPOOLED` and, for production, `UA_MIGRATE_APPROVED=1`.
3. Seed only fictional rows in development and staging.
4. Rehearse backup on loopback only: `UA_DISPOSABLE_POSTGRES=1` and database names starting with `ua_disposable`. `node scripts/release/disposable-postgres.mjs` migrates, inserts Casey Sample, dumps, restores into a second disposable database, and checks the row. It refuses Neon and any non-loopback host.
5. Code rollback is a redeploy of an older commit. Database recovery is a restore of **that environment’s** dump. Restoring code does not undo a migration. Never restore staging into production.

## Canada

Vercel can run functions in Montréal (`yul1`) on Pro. [Montréal region](https://vercel.com/changelog/introducing-the-montreal-canada-vercel-region-yul1), [region setting](https://vercel.com/docs/functions/configuring-functions/region), [yul1 rates](https://vercel.com/docs/pricing/regional-pricing/yul1). `vercel.json` pins `yul1` and the hourly cron. Both need Pro. Hobby deploy will reject the hourly cron, and yul1 rates are published for Pro.

Neon’s region list, last checked 18 November 2026, has no Canada region (`aws-ca-central-1` is absent). [Neon regions](https://neon.com/docs/introduction/regions). A Neon database would sit in the United States or another listed country, closest `aws-us-east-1` or `aws-us-east-2`. The region cannot be changed later. This app uses ordinary `pg`, so a PostgreSQL server actually located in Canada can be substituted later without a Neon driver. That choice is not made here.

## Review before creating accounts

Preview-only, on a host whose outbound block you have already seen answer “Nothing was sent.” Do not type Yes and do not click Approve.

1. Open the staging site and sign in with the fictional access code.
2. Ask for a Thank You preview to two fictional people. Both names appear. Nothing is sent.
3. Ask for a preview to a fictional person with no email. The preview says it cannot be sent.
4. Ask, in another wording, to stop one person and keep another. The stopped person is not prepared.
5. Switch chats, reopen, and refresh. Each preview stays on its own message.
6. Saved fictional newsletters, letters, cards, and drips are still the ones you saved.

Live mail, signatures, campaigns, and meetings are a later step. They require your approval of one exact preview, on a host where you have decided outbound may run. Do not do them on the published site as part of this preparation.

## Cost sketch, before tax, not an invoice

Separated on purpose. Confirm on the pricing pages before creating anything.

- Hosting: [Vercel pricing](https://vercel.com/pricing) shows Hobby at $0 and Pro at $20 per user each month, with $20 of included usage credit. Pro is the minimum for the hourly cron and for Montréal function rates. About 720 cron calls a month are function time, usually inside or just past that credit unless voice audio or large PDFs are heavy.
- Database: [Neon pricing](https://neon.com/pricing) shows Free at $0, and Launch as usage with no monthly minimum. Launch compute is $0.106 per CU-hour. Neon’s own intermittent-load example is about $15 a month (140 CU-hours and 1 GB). Use one Neon project, or one other Postgres database, per environment. Free is enough for a throwaway test.
- Jobs: no separate cron fee and no second queue vendor. The calls are Vercel function time.
- Storage: no Vercel Blob store is required for the current file path. If one is added later, see [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing).
- OpenAI, Microsoft mail, and Dropbox Sign are not in the hosting or database bill. They stay off while `UA_OUTBOUND_BLOCK=1`.

A green build, a passing test, or a new empty database is not a reason to publish, and it does not restore the old live records.
