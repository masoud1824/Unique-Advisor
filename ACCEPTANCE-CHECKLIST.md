# Acceptance checklist

Preview only, on the new staging host, after you have seen a tick answer that nothing was sent. Do not type Yes. Do not click Approve. Do not use a real client.

1. Confirm `GET /api/health` is up on the staging database and does not print a connection string.
2. Sign in with the fictional access code. The desk shows the fictional practice, not a live mailbox.
3. Ask for a Thank You preview to two fictional people. Both names appear. Nothing is sent.
4. Ask for a preview to a fictional person with no email. The preview says it cannot be sent.
5. Ask, in other words, to stop one person and keep another. The stopped person is not prepared.
6. Switch chats, reopen, and refresh. Each preview stays on its own message.
7. Ask, in English and in Farsi, to show a saved newsletter, letter, card, or drip without sending. The saved fictional records are the ones already stored. Nothing is reset.
8. Saved fictional newsletters, letters, cards, and drips still match the records you saved before this visit.
9. `GET /api/jobs/tick` without `CRON_SECRET` returns 401. With the secret, `blocked` is true and `sent` is 0.
10. Confirm `UA_JOBS_EXECUTE` is unset or unused. A value of `1` on this host must still leave `sent` at 0.
11. Birthday, drip, reply, and signature rows for a fictional advisor with no connected mailbox or Dropbox stay blocked. They are not marked sent.
12. Stop. Live mail, signatures, uploads, bookings, and campaigns are not part of this checklist.
