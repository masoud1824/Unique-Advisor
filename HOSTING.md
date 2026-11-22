# Independent hosting

This branch prepares a **new empty** Vercel + PostgreSQL environment. It is not a backup or a recovery of the published Unique Advisor database, and it does not attach to that database. The published site, the frozen acceptance desk, and every existing database stay untouched. Do not create accounts from this file until the costs and the Canada limitation below are accepted.

`release/combined-desk-review` stays as the code backup. This branch is `portability/vercel-neon`. Do not merge it to `main`.

## What runs

- Node 22, Vite 8, React 19, TanStack Start 1.169.4, Nitro preset `vercel`.
- Server entry is the Nitro output `.vercel/output` (`config.json` routes every path to `__server`). `npm run build` writes that output and does **not** migrate.
- Runtime SQL is `pg` when `DATABASE_URL` is set. `UA_DATA_PLANE=postgres` refuses the local PGLite fallback.
- Use Neon’s **pooled** URL as `DATABASE_URL` (`-pooler` in the host, `sslmode=require`). The pool in this app opens at most one connection per instance. Use the **direct** URL as `DATABASE_URL_UNPOOLED` for migrate, `pg_dump`, and `pg_restore`. See [Neon pooling](https://neon.com/docs/connect/connection-pooling) and [Neon on Vercel](https://neon.com/docs/connect/choose-connection).
- PDF work uses `pdf-lib` and `pdfjs-dist` in function memory. The hosted signature path stores the signed file in the advisor’s Dropbox. Dropbox Sign is the only signature provider this scheduler calls. DocuSign, Adobe Sign, Box, Google Drive, and OneDrive stay paused and are not activated here. Card text and newsletter payloads are rows in Postgres. Vercel’s disk is ephemeral and is not a database.

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

Vercel Cron calls `GET /api/jobs/tick` at minutes 0, 15, 30, and 45 (`0,15,30,45 * * * *`). That is required so a time zone such as `America/St_Johns` (UTC−3:30) or `Asia/Kathmandu` (UTC+5:45) still hits local 9:00. An hourly cron misses those zones. Vercel sends `Authorization: Bearer` from `CRON_SECRET` (16 characters or more). A wrong or missing secret gets 401. Each call is logged in `hosted_job_runs`. That log is not the send lock.

The tick claims each due job in `hosted_jobs` (identity, attempt, two-minute lease, `not_before`, provider id, and status `pending`, `claimed`, `accepted`, `failed`, `unknown`, or `skipped`). A second tick does not resend work that is `accepted` or `unknown`. `failed` may be claimed again. A claim whose lease expires before a result is stored becomes `unknown` and is not sent again. A reply whose notice row was never stored is the exception: that job returns to `failed` so the notice can be stored once. Birthday claims stay in `birthday_claims` with the same accepted / failed / unknown rule, and only when the advisor has enabled that confirmed card version.

`GET /api/jobs/tick` attaches the production adapters only when every guard passes: `UA_HOST_ENV=production`, `UA_JOBS_EXECUTE=1`, outbound is not blocked, the release environment is not `staging` or `development`, and the mail and signature budget switches are open. `UA_JOBS_EXECUTE=1` by itself does not attach an adapter and does not bypass those guards or an advisor's approval. Staging stays fail-closed (`UA_RELEASE_ENV=staging` and `UA_OUTBOUND_BLOCK=1`). The adapters are Microsoft Graph `sendMail` for birthday and drip mail, Microsoft Graph conversation read for reply monitoring, Dropbox Sign status, and Dropbox file upload. Each call uses that advisor's own stored connection. A missing mailbox, Dropbox Sign connection, Dropbox connection, folder, or unconfirmed card is stored as blocked (`failed` with a reason) and is not reported as sent. An uncertain provider result stays `unknown` and is not repeated. DocuSign, Adobe Sign, Box, Google Drive, and OneDrive stay paused. Zoom is not called by this scheduler.

The advisor-local 9:00 window, including daylight saving, is `America/Toronto` 14:00 UTC in January and 13:00 UTC in July. The same window is 12:30 UTC in January for `America/St_Johns` and 03:15 UTC for `Asia/Kathmandu`. A late same-day catch-up still runs until 15:00 local if yesterday was the last run. Hobby cron is once a day and cannot keep this promise. Pro is required for a quarter-hour schedule. Cron pricing and limits: [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing). Cron authentication: [Manage Cron Jobs](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs). Cron runs only on that project’s production deployment, which is why staging must be its own project.

Signature callbacks are inbound `POST /api/dropbox-sign/event`, verified with the advisor’s key. Duplicate event hashes are ignored by the primary key. Filing a completed Dropbox Sign file into Dropbox is a separate job. An unknown upload is not retried. Reply notices stay deduped by message id. No extra queue product is required for this volume. If one tick ever needs longer than the function limit, use [Vercel Workflows](https://vercel.com/docs/workflows) later. Do not add a timer inside a request. Function limits: [Vercel Functions](https://vercel.com/docs/functions/limitations).

## Auth, callbacks, voice

- Set `PUBLIC_APP_URL` or `BETTER_AUTH_URL` to that environment’s `https` origin (http is accepted only for localhost). The app does not invent `youradviser.grok.me`. If the origin is unset, generated links stay on the current host as a path, and Zoom sign-in does not start.
- Better Auth’s session cookie is `__Host-` (Secure, Path=/, no Domain). That requires https and the public URL above. The desk access-code cookie `ua_desk` is host-only as well. Do not set `Domain=.grok.me`.
- Hosted mode does not fall back to the shared Grok preview OAuth client. Leave `GROK_AUTH_*` empty unless that environment has its own broker client. The advisor desk still uses its access code. These checks are not relaxed for a new domain.
- Register these paths on the **new** domain at each provider before connecting an account: `/api/microsoft/callback`, `/api/google/callback`, `/api/zoom/callback`, `/api/box/callback`, `/api/link/callback`, `/api/dropbox-sign/event`. Microsoft and the other link callbacks must match this request’s host and use https, except localhost. `MICROSOFT_REDIRECT_URI` can pin Microsoft. Zoom uses only `PUBLIC_APP_URL` and refuses to start when it is unset. Box, Google, and OneDrive remain paused.
- Voice is browser `MediaRecorder` plus the Web Speech API, then `POST /api/assistant/voice`. The reply is server-sent `text/event-stream` audio, not a WebSocket. Microphone, spoken audio, interruption, and live providers are not tested here.

## Secrets, health, logs, budget

Names live in `.env.example`. Values do not go in GitHub. `GET /api/health` returns `ok`, the data plane, and `up` or `down`. It does not return rows or URLs. Log lines from the health and job paths pass through redaction for URLs, bearer tokens, and mailbox addresses.

Before any paid project exists, set a Vercel spend limit and a Neon usage limit. `UA_BUDGET_HALT=1` stops mail and signature provider calls. `UA_BUDGET_HALT_OPENAI`, `UA_BUDGET_HALT_MAIL`, and `UA_BUDGET_HALT_SIGNATURE` are the narrower switches. A closed switch does not call the injected provider.

## Migrate, backup, rollback

1. Create an empty database. Do not paste the published connection string.
2. `npm run db:migrate` with `DATABASE_URL_UNPOOLED` and, for production, `UA_MIGRATE_APPROVED=1`.
3. Seed only fictional rows in development and staging.
4. Rehearse backup on loopback only: `UA_DISPOSABLE_POSTGRES=1` and database names starting with `ua_disposable`. `node scripts/release/disposable-postgres.mjs` migrates, inserts Casey Sample, dumps, restores into a second disposable database, and checks the row. It refuses Neon and any non-loopback host. This sandbox cannot run that server (Postgres refuses root, and this environment cannot drop privileges). GitHub Actions on the public repo can run `.github/workflows/disposable-postgres.yml` with a `postgres:16` service and no production credentials. A PGLite schema check is not that proof.
5. Code rollback is a redeploy of an older commit. Database recovery is a restore of **that environment’s** dump. Restoring code does not undo a migration. Never restore staging into production.

## Canada

Vercel can run functions in Montréal (`yul1`) on Pro. [Montréal region](https://vercel.com/changelog/introducing-the-montreal-canada-vercel-region-yul1), [region setting](https://vercel.com/docs/functions/configuring-functions/region), [yul1 rates](https://vercel.com/docs/pricing/regional-pricing/yul1). `vercel.json` pins `yul1` and the quarter-hour cron. Both need Pro. Hobby deploy will reject that cron, and yul1 rates are published for Pro.

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

- Hosting: [Vercel pricing](https://vercel.com/pricing) shows Hobby at $0 and Pro at $20 per user each month, with $20 of included usage credit. Pro is the minimum for the quarter-hour cron and for Montréal function rates. About 2,880 cron calls a month are function time, usually inside or just past that credit unless voice audio or large PDFs are heavy.
- Database: [Neon pricing](https://neon.com/pricing) shows Free at $0, and Launch as usage with no monthly minimum. Launch compute is $0.106 per CU-hour. Neon’s own intermittent-load example is about $15 a month (140 CU-hours and 1 GB). Use one Neon project, or one other Postgres database, per environment. Free is enough for a throwaway test.
- Jobs: no separate cron fee and no second queue vendor. The calls are Vercel function time.
- Storage: no Vercel Blob store is required for the current file path. If one is added later, see [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing).
- OpenAI, Microsoft mail, and Dropbox Sign are not in the hosting or database bill. They stay off while `UA_OUTBOUND_BLOCK=1`.

A green build, a passing test, or a new empty database is not a reason to publish, and it does not restore the old live records.
