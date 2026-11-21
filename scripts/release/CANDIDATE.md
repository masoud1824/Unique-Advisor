# Staging candidate

This note belongs to the staging commit on `release/process` that adds it. `/opt/ua-release/repos/dev` at `539fdb2` is not the release. Copies of `0032_desk_language.sql` and `0033_action_message.sql` may sit untracked in that dev tree; they are not a second release commit. Acceptance `/workspace` is not this commit.

## What was checked

Node tests, schema upgrade, disposable database, production build, and the publication migration command:

```
unset DATABASE_URL
cd /opt/ua-release/repos/staging
UA_RELEASE_ENV=staging UA_RELEASE_DB_NAME=staging node scripts/release/validate.mjs
```

Log: `/opt/ua-release/logs/validate-candidate.log`. Result: **191 pass, 0 fail**, 28 suites, then schema upgrade, disposable database, `vite build` exit 0, and `node scripts/migrate.mjs`. With `DATABASE_URL` unset, migrate prints `DATABASE_URL not set — skipping` and exits 0. That is the explicit publication step. It did not touch a production database.

Schema upgrade from the acceptance files `0002`–`0027` (26) plus the six later files through `0033_action_message.sql`, on a disposable copy: `messageIdMissingOnBaseline: true`, `messageIdSelectableAfterUpgrade: true`. The disposable directory is deleted by the script. No production migration was run.

`validate.mjs` does not open a browser. Lines in the Vite build that say "browser compatibility" mean Node built-ins were externalized. They are not a desk run.

The desk workflow is a separate Playwright Chromium script against `http://127.0.0.1:8093` only:

```
cd /opt/ua-release/repos/staging
node scripts/release/browser-workflow.mjs
```

Log: `/opt/ua-release/logs/browser-workflow.console.log` (`EXIT:0`). JSON: `/opt/ua-release/logs/browser-workflow.log` (`unitTests: false`, `browser: playwright-chromium`). It is not part of the 191. An earlier "189 checks" figure is wrong for this commit. Do not describe the Vite externalize warnings as Chromium.

Typecheck, same compiler, `--noEmit --pretty false --incremental false`:

| Tree | Errors |
|---|---|
| Acceptance baseline `/tmp/tsc-workspace.txt` | 1268 |
| This staging tree `/tmp/tsc-staging.txt` | 1186 |

Digit-normalized message text: **0 extra instances** versus that baseline. Neither tree typechecks. A passing build is not a passing typecheck. New errors were not hidden with `any`, `@ts-ignore`, or a weaker `strict` setting.

## Browser result on fictional staging data

Outbound mail stayed blocked (`UA_OUTBOUND_BLOCK=1`, `UA_RELEASE_ENV=staging`). The script passed: Thank You card for Casey Sample and Riley Sample as one preview; Avery Sample missing-email warning; Farsi cancel keeping Quinn Sample and not sending; newsletter, letter, and drip for both names; scroll, reopen, and refresh keeping each preview; historical previews without Approve and send; identity "Yes" reaching a Birthday Wishes preview for Jordan Example; the next "Yes" answered "More than one action is waiting. Tell me which one to approve. I did not send anything." Casey Sample still read back as `casey.sample@example.invalid`. Morgan Sample was not pulled in.

## Not done

- Microphone and voice hardware were not exercised.
- Published `_migrations` for project `01a17a99-541a-7763-ae9b-ee1963647c15` are unknown. Homepage metadata is not the database. This sandbox has no production `DATABASE_URL` and no owner backup control for that project. Support must provide a backup of the database actually bound to that project, plus the `_migrations` filenames already applied. Do not substitute the acceptance PGLite directory or `scripts/release/export-acceptance.mjs`. `HOSTING.md` "new empty database" is a private-host proposal, not proof that the next publish creates one.
- Publication to the existing Unique Advisor site stays blocked until that backup and ledger exist. It is not unauthorized. Nothing was published from this commit.
