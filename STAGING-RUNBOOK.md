# Staging website — ready to execute

Deploy this commit of `portability/vercel-neon` only. It is not the published Unique Advisor site, not the frozen acceptance desk, and not a restore of either database. Do not point any step at an existing database, port 8080, or `main`.

No website exists until the account decision at the bottom is approved and these steps are run. Do not paste secrets into chat or git.

## Recommended configuration

| Piece | Choice | Monthly base, before tax |
|---|---|---|
| App | One new Vercel Pro project, 1 seat. Functions in Montréal `yul1`. | $20, which includes $20 of usage credit |
| Scheduler | The quarter-hour cron already in `vercel.json`. Hobby cannot deploy it. | Function time, inside the credit at this volume |
| Database | One new empty Neon project, Free plan, Postgres only. Region `aws-us-east-1` (N. Virginia). Compute 0.25 CU, scale to zero after 5 minutes. | $0 |
| Hostname | The project `*.vercel.app` name. No domain purchase. | $0 |
| Files | Stay in Postgres. Do not add Vercel Blob. | $0 |
| AI and providers | Leave OpenAI, Microsoft, Dropbox, and Dropbox Sign unset until a separate approval. The model is a later decision, not part of this hosting bill. | $0 while outbound is blocked and `UA_AI_ENABLED` is unset |

About 2,880 cron calls a month. At well under a second of Montréal CPU (`$0.1469` per CPU-hour) and memory (`$0.01217` per GB-hour), that is cents, not a second bill. Sources, checked 22 Nov 2026: [Vercel Pro](https://vercel.com/docs/plans/pro-plan), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [yul1 rates](https://vercel.com/docs/pricing/regional-pricing/yul1) (updated 14 Sep 2026, Pro only), [Neon regions](https://neon.com/docs/introduction/regions) (updated 18 Nov 2026, no Canada region), [Neon plans](https://neon.com/docs/introduction/plans) (updated 18 Nov 2026).

Outside Canada: the database, Neon backups, and Vercel environment variables are in the United States. Function execution is in Montréal. Build logs are on Vercel and are not a Canada-only store. Do not enable Web Analytics. Do not buy Password Protection (`$20` extra per project); the desk has its own access code. Standard Protection can require a Vercel login for preview URLs and is included.

Neon Free includes 100 CU-hours per project. The cron wakes the database about every 15 minutes and scale-to-zero sleeps it after 5 minutes, which stays near 60 CU-hours at 0.25 CU. If the meter climbs past 100, Free suspends the compute until the next period. It does not charge. Launch is the later choice, at `$0.106` per CU-hour and `$0.35` per GB-month, with no monthly minimum. A 0.25 CU endpoint left always on is about `$19` of compute. A future real production website is a second Vercel project and a second database, not this one. OpenAI is not part of the hosting bill. If a model test is approved later, that is a separate OpenAI spend cap.

## What “Production” means on this project

Vercel has three environment slots on one project: Production, Preview, and Development. For this project, Vercel’s Production slot is the staging website. It is not the future real production environment.

| Place | Database and secrets | Flags |
|---|---|---|
| Your computer | Its own disposable database, or PGLite with `DATABASE_URL` unset. Never the staging URL. | `UA_HOST_ENV=development`, `UA_RELEASE_ENV=development`, `UA_OUTBOUND_BLOCK=1`. Leave `UA_AI_ENABLED` unset. |
| Vercel Production slot of this staging project | The one new Neon staging database. `CRON_SECRET` and `BETTER_AUTH_SECRET` exist only here. | `UA_HOST_ENV=staging`, `UA_RELEASE_ENV=staging`, `UA_OUTBOUND_BLOCK=1`. Cron runs only against this deployment. |
| Vercel Preview slot | No database URL and no secret from the row above. A preview build must not be able to write the staging database. | `VERCEL_ENV=preview` also blocks outbound calls if a flag is forgotten. That is not a reason to copy the database. |
| Vercel Development slot (`vercel dev`) | No staging database and no staging secret. | Local development stays on the computer row. |
| Future real production | A second Vercel project and a second database, created only after a separate approval. | `UA_HOST_ENV=production` only then. `UA_JOBS_EXECUTE` stays unset until that approval. |

Do not paste one `DATABASE_URL`, `CRON_SECRET`, or provider key into more than one of those rows.

`npm run build` does not migrate. Schema changes on a future production database stay behind `UA_MIGRATE_APPROVED=1`. Do not connect `main`. Do not turn on automatic Git promotion after the one staging deployment. Preview deployments of this project stay blocked by `VERCEL_ENV=preview` as well as by the staging flags. Cron runs only against the project's production deployment ([Vercel cron](https://vercel.com/docs/cron-jobs), updated 16 Sep 2026).

## Model test, not activated

Chat, transcription, and spoken replies use `modelTransportOpen()`. Mail, signatures, Dropbox uploads, calendar writes, and campaigns use `outboundBlocked()`. Those are different gates.

On the staging website, outbound stays blocked. A model call is allowed only when both of these are true: `UA_AI_ENABLED=1`, and the OpenAI budget is open (`UA_BUDGET_HALT` and `UA_BUDGET_HALT_OPENAI` are not `1`). An `OPENAI_API_KEY` by itself does not turn the model on. This preparation did not set either variable and did not call OpenAI. A rule-based English or Farsi reply is not model verification.

The separate approval, if you want a real model check later, is only:

- One OpenAI key and a monthly spend cap, for this staging project only.
- Set `OPENAI_API_KEY` and `UA_AI_ENABLED=1` on the Vercel Production slot of this staging project only. Do not set them on Preview, Development, your computer, or a future production project.
- Leave `UA_OUTBOUND_BLOCK=1`, `UA_RELEASE_ENV=staging`, and `UA_HOST_ENV=staging`. Leave `UA_JOBS_EXECUTE` unset.
- After the cap is in place, `UA_BUDGET_HALT_OPENAI=1` stops further model calls without opening mail.

That later check can type a natural-language command and can send a recording to transcription. It still cannot send mail, request a signature, upload to Dropbox, write a calendar, or start a campaign. The browser microphone, spoken playback, and interruption stay a separate HTTPS browser check. Do not obtain the key or turn this on as part of creating the website.

## Execute, in order

1. Create the Neon project in `aws-us-east-1`. Database name must contain `staging`, for example `ua_staging`. Copy the pooled URL and the direct URL in the Neon UI. Both need `sslmode=require`. Do not send them here.
2. Create the Vercel project from GitHub `masoud1824/Unique-Advisor`, branch `portability/vercel-neon`, the commit that contains this runbook. Framework preset Other. Node 22. Install command `npm install --omit=dev --no-audit --no-fund`. Build command `npm run build`. Do not set a deploy command that migrates.
3. Before the first deployment is kept, set variables on the Vercel Production slot only. Generate values in the host. Do not copy them to Preview or Development.

   Set on Production only: `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), `UA_DATA_PLANE=postgres`, `UA_HOST_ENV=staging`, `UA_RELEASE_ENV=staging`, `UA_OUTBOUND_BLOCK=1`, `CRON_SECRET` (16 characters or more), `PUBLIC_APP_URL` (the https origin), `BETTER_AUTH_URL` (same origin), `BETTER_AUTH_SECRET`.

   Leave unset everywhere: `UA_JOBS_EXECUTE`, `UA_MIGRATE_APPROVED`, `UA_BIRTHDAY_LIVE`, `UA_HOSTED_SEED`, `UA_AI_ENABLED`, `OPENAI_API_KEY`, `GROK_AUTH_CLIENT_ID`, `GROK_AUTH_CLIENT_SECRET`, `GROK_CONNECTOR_ACCESS_TOKEN`, Microsoft, Dropbox, and SMTP values.
4. Turn off automatic Git deployments after this one deployment, so a later push does not promote itself. Settings → Git. Do not enable automatic production promotion.
5. On your own computer, from this commit, with the direct URL only in that shell: `UA_HOSTED_SEED=yes UA_HOST_ENV=staging UA_RELEASE_ENV=staging UA_OUTBOUND_BLOCK=1 npm run db:migrate` then `node scripts/release/seed-hosted.mjs`. The seed refuses a database whose name does not contain `staging`, a database that already has advisors, and a missing `0035` migration. It writes `staging-access.local.txt` and prints counts only. Do not commit or paste that file.
6. Open `GET /api/health`. Expect `ok: true`, `plane: "postgres"`, `database: "up"`, `hostEnv: "staging"`. It must not show a URL.
7. Open `GET /api/jobs/tick` with a wrong bearer and expect 401. With `CRON_SECRET`, expect `blocked: true` and `sent: 0`.
8. Sign in with the advisor code from the local file at `/a/staging-practice/desk`. Follow [ACCEPTANCE-CHECKLIST.md](ACCEPTANCE-CHECKLIST.md). Do not type Yes. Do not click Approve.

Rollback: in Vercel, Instant Rollback to the previous deployment, or delete this project. That does not touch the old desk. To drop the staging data, delete the Neon project. Code rollback does not restore a database. There is nothing old in this database to restore.

Callbacks, only if a provider is approved later, on that https origin: `/api/microsoft/callback`, `/api/google/callback`, `/api/zoom/callback`, `/api/box/callback`, `/api/link/callback`, `/api/dropbox-sign/event`. Do not register them for this blocked staging pass.

## Not this step

Creating the website does not test the language model. Checklist step 7 shows saved fictional records. It is not an OpenAI result. Microphone permission, spoken playback, and interruption are browser checks on the HTTPS desk after it exists. A typed message is not a microphone test. A live Microsoft, Dropbox, or Dropbox Sign call needs a separate approval after a blocked tick has been seen.

## Decisions, once

1. Hosting. Approve or refuse Vercel Pro at $20 per month, functions in Montréal `yul1`, and one new Neon Free database in `aws-us-east-1`. Do not create either account until that spend and location are approved. No website exists yet.
2. Model, separate from item 1 and not required to create the website. Approve or refuse one staging-only OpenAI key, a monthly spend cap, and `UA_AI_ENABLED=1` on the Vercel Production slot of the staging project. It was not obtained and not turned on. A mocked or rule-based reply is not that test.
