# Code backup

Branch `release/combined-desk-review` is a backup of application source. It is not a backup of the published database, and it was not created by publishing or by copying a live database.

The tested desk candidate this branch starts from is commit `8b0e86f687e448f903b7e9e44f2bdf2cd9bfe128` on `release/process`. A later commit on this branch replaces two real mailbox addresses with `reviewer@example.invalid` and `desk@example.invalid` so this public code backup does not contain them. Behavior of the fictional signature and document-mail fixtures follows those placeholders. The older development checkout is not this branch.

Do not merge this branch into `main` until the published-database backup and the applied migration ledger are confirmed. No credentials, `.env` files, database files, or client exports are included.
