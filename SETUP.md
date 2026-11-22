# Setup

This is application source. It is not a backup of the published database, and it does not contain client records.

1. Use Node 22.
2. Copy `.env.example` to `.env` and fill values on your own machine. Leave `DATABASE_URL` empty to use the local PGLite fallback. Do not commit `.env`.
3. Run `npm install`.
4. Apply SQL in `migrations/` only to a database you are allowed to change. `npm run db:migrate` skips itself when `DATABASE_URL` is unset.
5. `npm test` runs the script and auth/desk unit tests. `node scripts/release/validate.mjs` is the isolated release check and refuses to run while `DATABASE_URL` is set.
6. Do not point this checkout at the published site or at a production database.

Outbound mail, provider calls, and uploads stay off when `UA_OUTBOUND_BLOCK=1`.
