# Chef Support Dashboard

Day-to-day production monitoring across **Pylon** (open issues per customer), **Datadog** (per-module health), **BigQuery** (uptime / downtime / throughput / missed bowls / pstops), plus team-entered status for 14 customers / 56 robots.

- **Stack:** Next.js 14 (App Router) · Auth.js v5 (Google SSO) · Neon Postgres + Drizzle ORM · Tailwind CSS.
- **Auth:** Google sign-in restricted to `@chefrobotics.ai` by default. Editors are a named list (`EDITOR_EMAILS`); everyone else is read-only.
- **Hosting:** designed to deploy to Vercel + Neon.

See **DEPLOY.md** for the end-to-end deploy walkthrough.

## Local development

```bash
npm install
cp .env.example .env.local
# fill in AUTH_SECRET, AUTH_GOOGLE_ID/SECRET, DATABASE_URL, PYLON_API_KEY at minimum
npm run db:push      # creates tables in Neon
npm run dev          # http://localhost:3000
```

## Layout

```
app/
  page.tsx                 # server-rendered dashboard
  api/
    auth/[...nextauth]     # Auth.js endpoints
    pylon/                 # GET aggregated open issues
    datadog/               # placeholder until credentials set
    bigquery/              # placeholder until credentials set
    customers/             # CRUD (editor-only writes)
    modules/               # CRUD (editor-only writes)
    daily-note/            # GET/PUT (editor-only writes)
  components/              # client components
lib/
  db.ts, schema.ts         # Drizzle + Postgres
  auth-config.ts           # Auth.js shared config
  pylon.ts, datadog.ts, bigquery.ts
drizzle/
  0000_init.sql            # generated migration
```
