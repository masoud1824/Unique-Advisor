# Unique Advisor

Source export of the Unique Advisor app. No API keys, passwords, client records, or uploaded client files are included.

## Requirements

- Node.js 20 or newer
- npm

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example configuration and fill in values locally. Do not commit that file.

   ```bash
   cp .env.example .env
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

   The dev server listens on port 8080. Without `DATABASE_URL`, the app uses an embedded database for local development. Set `DATABASE_URL` to a Postgres connection string for a persistent database.

4. Apply database migrations:

   ```bash
   npm run db:migrate
   ```

5. Run tests:

   ```bash
   npm test
   ```

## What is included

- Application source in `src`
- Public brand and template assets in `public`
- Database migrations in `migrations`
- Setup scripts in `scripts`
- `package.json` and `package-lock.json`

## What is not included

- Secrets and environment values
- Client records and database exports
- Uploaded client files
- `node_modules`

The preview OAuth client secret that was previously hard-coded has been removed from this export. Provide `GROK_AUTH_CLIENT_SECRET` through the environment when that sign-in path is required.
