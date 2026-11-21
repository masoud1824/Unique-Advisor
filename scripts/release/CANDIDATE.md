# Staging candidate

This note belongs to the staging commit on `release/process` that adds it. `/opt/ua-release/repos/dev` at `539fdb2949ba5cc06bbe9a83a77357041ed8e399` is intentionally not the release. Copies of `0032_desk_language.sql` and `0033_action_message.sql` may sit untracked in that dev tree; they are not a second release commit. Acceptance `/workspace` is not this commit.

Installed versions when these logs were produced: Node v22.23.3, Vite 8.3.4, React 19.3.0, `@tanstack/react-start` 1.169.4, `@tanstack/react-router` 1.170.46, TypeScript 5.9.3, Playwright 1.64.0. Manifest ranges are wider; Start is pinned at 1.169.4.

## What was checked

Node tests, schema upgrade, disposable database, production build, and the publication migration command:

```
unset DATABASE_URL
cd /opt/ua-release/repos/staging
UA_RELEASE_ENV=staging UA_RELEASE_DB_NAME=staging node scripts/release/validate.mjs
```

Log: `/opt/ua-release/logs/validate-candidate.log` (exit 0). Result: **191 pass, 0 fail**, 28 suites, then schema upgrade, disposable database, `vite build` exit 0, and `node scripts/migrate.mjs`. With `DATABASE_URL` unset, migrate prints `DATABASE_URL not set — skipping` and exits 0. That is the explicit publication step. It did not touch a production database.

Schema upgrade from the acceptance files `0002`–`0027` (26) plus the six later files through `0033_action_message.sql`, on a disposable copy: `messageIdMissingOnBaseline: true`, `messageIdSelectableAfterUpgrade: true`. The disposable directory is deleted by the script. No production migration was run.

`validate.mjs` does not open a browser. Lines in the Vite build that say "browser compatibility" mean Node built-ins were externalized. They are not a desk run. An earlier "189 checks" figure is wrong. Do not describe those Vite lines as Chromium.

The desk workflow is a separate Playwright Chromium script against `http://127.0.0.1:8093` only:

```
cd /opt/ua-release/repos/staging
node scripts/release/browser-workflow.mjs
```

Log: `/opt/ua-release/logs/browser-workflow.console.log` (`EXIT:0` at 2026-11-21T19:59:14.836Z). JSON: `/opt/ua-release/logs/browser-workflow.log` (`failed: 0`, 22 findings, `unitTests: false`, `browser: playwright-chromium`, base `http://127.0.0.1:8093`). Screenshot: `/opt/ua-release/artifacts/browser-workflow/workflow.png`. `failure.png` is an earlier failed run, not this pass. The script asserts each outcome. It does not treat "the browser stayed open" as success.

Typecheck, same compiler, `npx tsc --noEmit --pretty false --incremental false`:

| Tree | `error TS` headers |
|---|---|
| Acceptance baseline `/tmp/tsc-workspace.txt` (2026-11-21 18:51:31 UTC) | 1268 |
| This staging tree `/tmp/tsc-staging.txt` | 1185 |

Comparison identity is file + TS code + exact message, with numeric values kept. Line and column are not part of the identity. Extra groups: 0. Extra instances: 0. Some existing diagnostics moved lines (about 300 keys). Neither tree typechecks. A passing build is not a passing typecheck. New errors were not hidden with `any`, `@ts-ignore`, or a weaker `strict` setting. `deliverStagedById` parameters are explicitly typed so they do not add a new implicit-any diagnostic.

## Browser result on fictional staging data

Outbound mail stayed blocked (`UA_OUTBOUND_BLOCK=1`, `UA_RELEASE_ENV=staging`). Providers were not called. The script asserts:

- Contacts table captured before any chat work includes Casey Sample `casey.sample@example.invalid`, Morgan Sample, and Avery Sample.
- Saved Casey Sample read-back names the contacts table and that email, and does not include Morgan Sample.
- Thank You for Casey Sample and Riley Sample is one confirm, not "or", and says nothing was sent.
- Avery Sample preview says no email is saved and is not sendable.
- Farsi "کارت تولد را برای جردن بفرست. لغو. آن را برای کوین بفرست." names Quinn Sample as unsubscribed, cancels Jordan Example, and does not send.
- Newsletter, e-letter, and Welcome Drip each confirm both Casey Sample and Riley Sample and do not say a message is on its way.
- After those turns, the Thank You send (id 46), newsletter (id 48), e-letter (id 49), and drip (id 50) were still `data-can-send=yes` and `pending`. Avery's preview-only row was `discarded` and not sendable. The same id, send flag, status, and summary set was still there after scrolling to the top, opening a new chat and reopening this one, and reloading the page.
- Non-sendable previews had no Approve and send button.
- Discard on the still-pending Thank You preview removed its send button.
- Approve on a different still-pending preview (newsletter id 48) returned a blocked result containing "Nothing was sent", not "already handled" and not "on its way". That preview stayed `data-can-send=yes`.
- Replaying that same server function with the action id changed to the discarded Thank You id returned `That request was already handled. Nothing was sent.` The body did not say anything was on its way. The access code was not written to the log.
- A later new chat's "Yes" after "Did you mean the Birthday Wishes card for Jordan Example?" reached `Just to confirm: send the Birthday Wishes e-card to Jordan Example?` and did not say the approval was no longer valid.
- The following "Yes" returned `Outbound mail, provider calls, and uploads are blocked in this environment. Nothing was sent.` It did not say more than one action was waiting, and it did not say the card was on its way. Other pending previews were not treated as invalid.
- The Casey Sample read-back was unchanged, and the contacts table text after the run matched the text from before it.

A cancelled name withdraws only pending card rows whose summary names that person. It does not discard every older pending card, newsletter, letter, or campaign.

## Not done

- Microphone and voice hardware were not exercised.
- Published `_migrations` for project `01a17a99-541a-7763-ae9b-ee1963647c15` are unknown. Homepage metadata is not the database. This sandbox has no production `DATABASE_URL` and no owner backup control for that project. Support must provide a backup of the database actually bound to that project, plus the `_migrations` filenames already applied. Do not substitute the acceptance PGLite directory or `scripts/release/export-acceptance.mjs`. `HOSTING.md` "new empty database" is a private-host proposal, not proof that the next publish creates one.
- Publication to the existing Unique Advisor site stays blocked until that backup and ledger exist. It is not unauthorized. Nothing was published from this commit.
