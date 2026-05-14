# Deploy guide — Chef Support Dashboard

This walks you from "fresh repo" to "live URL my team can use" in under an hour.

You'll need accounts on:
- **GitHub** (host the code)
- **Vercel** (run the app — free tier is plenty for this load)
- **Neon** (Postgres — free tier is plenty)
- **Google Cloud** (OAuth consent screen + Web Client ID — free)
- **Pylon** (Admin access to mint an API token)

Datadog and BigQuery credentials are optional for v1 — the dashboard renders "awaiting credentials" panels for them until you set the env vars.

---

## 1. Push the project to GitHub

```bash
cd chef-support-dashboard
git init
git add .
git commit -m "Initial commit: Chef Ops Dashboard"
gh repo create chef-robotics/chef-support-dashboard --private --source=. --push
# or: create the repo manually and `git remote add origin … && git push -u origin main`
```

## 2. Create a Neon Postgres database

1. Go to https://console.neon.tech → **New Project** (region: closest to your team).
2. After it's created, copy the **pooled** connection string from the Neon dashboard (under "Connection details → Pooled connection"). It looks like
   `postgresql://USER:PASS@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`.
3. Keep that string handy — you'll paste it into Vercel as `DATABASE_URL`.

## 3. Set up Google OAuth (for SSO)

1. Go to https://console.cloud.google.com → pick your Chef Robotics workspace project (or create one).
2. **APIs & Services → OAuth consent screen**: User type = **Internal** (so only @chefrobotics.ai can sign in even without our backend check). Fill in the app name, support email, and your domain. No scopes beyond default.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `https://YOUR-VERCEL-DOMAIN.vercel.app/api/auth/callback/google` (you'll know the exact domain after step 4 — come back and add it then).
   - For local dev also add: `http://localhost:3000/api/auth/callback/google`.
4. Copy the **Client ID** and **Client secret**.

## 4. Deploy to Vercel

1. Go to https://vercel.com/new → **Import Git Repository** → select the repo you just pushed.
2. Vercel will autodetect Next.js. Leave build settings on defaults.
3. **Don't deploy yet.** Click **Environment Variables** and add:

   | Variable | Value |
   |---|---|
   | `AUTH_SECRET` | output of `openssl rand -base64 32` |
   | `AUTH_GOOGLE_ID` | from step 3 |
   | `AUTH_GOOGLE_SECRET` | from step 3 |
   | `ALLOWED_EMAIL_DOMAINS` | `chefrobotics.ai` |
   | `EDITOR_EMAILS` | comma-separated emails of people who can edit (e.g. `sakshi@chefrobotics.ai,alex@chefrobotics.ai`) |
   | `DATABASE_URL` | Neon pooled connection string from step 2 |
   | `PYLON_API_KEY` | from Pylon admin → API tokens |

4. Click **Deploy**. Wait ~90 seconds.
5. After it deploys, Vercel gives you a URL (e.g. `chef-support-dashboard.vercel.app`). Go back to step 3 and add that URL's `/api/auth/callback/google` to the Google OAuth client's authorized redirect URIs. Save.

## 5. Run the database migration

The schema needs to be applied to Neon once. From your local machine:

```bash
cp .env.example .env.local
# paste the same DATABASE_URL into .env.local
npm install
npm run db:migrate
```

You should see `Applying 0000_init.sql…` then `Migrations applied.`

Then load the seed customers (Amy's Medford, Amy's Pocatello, Bonduelle, Cafe Spice, Chef Bombay, f&S, Cookunity, POH):

```bash
npm run db:seed
```

This is idempotent — running it twice is safe. To change the list, edit `scripts/seed.ts`.

## 6. Test sign-in

1. Open your Vercel URL.
2. Click **Continue with Google**, sign in with your `@chefrobotics.ai` account.
3. You should land on the dashboard. The Pylon section should populate. Datadog/BigQuery should show "awaiting credentials". The manual-entry section will be empty.
4. If your email is in `EDITOR_EMAILS`, you'll see an **Editor** badge and the input fields will be enabled.

## 7. (Optional) Wire Datadog

Add to Vercel env vars and redeploy:
- `DATADOG_API_KEY` — from `/organization-settings/api-keys`
- `DATADOG_APP_KEY` — from `/personal-settings/application-keys`
- `DATADOG_SITE` — e.g. `datadoghq.com` (US1), `us3.datadoghq.com`, `datadoghq.eu`

Then check `lib/datadog.ts` — the metric names and tag keys are placeholders (`chef.module.picks.total`, `chef.module.network.latency_ms`, tag key `module`). Update them to match what your robots actually emit.

## 8. (Optional) Wire BigQuery

1. In GCP, create a service account with the **BigQuery Data Viewer** + **BigQuery Job User** roles, scoped to the dataset.
2. Generate a JSON key. Then on your machine:
   ```bash
   cat path/to/sa-key.json | base64 | tr -d '\n'
   ```
3. Add to Vercel env vars and redeploy:
   - `GCP_SA_KEY_BASE64` — the base64 string above
   - `GCP_PROJECT_ID` — your GCP project ID
   - `BQ_METRICS_TABLE` — fully-qualified, e.g. `chef-prod.ops.daily_metrics`
4. The query in `lib/bigquery.ts` expects columns: `customer, module_id, date, uptime_pct, downtime_min, throughput, missed_bowls, pstops`. If your view names them differently, edit the SQL.

## 9. Custom domain (optional)

In Vercel → Project → **Settings → Domains**, add `ops.chefrobotics.ai` (or whatever subdomain you want). Vercel will tell you the CNAME to add at your DNS provider. After DNS propagates, add the new URL to the Google OAuth redirect URIs (`/api/auth/callback/google`).

---

## Day-to-day

- **Add/remove editors**: update `EDITOR_EMAILS` in Vercel → Settings → Environment Variables, then redeploy (or use Vercel's "Promote to Production" without rebuild).
- **Logs**: Vercel dashboard → your project → Logs. Server errors from Pylon/Datadog/BigQuery surface there.
- **Audit log**: the `audit_log` table in Neon records every manual edit. Query it from the Neon SQL console.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Configuration error" on sign-in | `AUTH_SECRET` not set, or `AUTH_GOOGLE_ID/SECRET` wrong |
| Sign-in succeeds but bounces back | redirect URI in Google Console doesn't match Vercel URL exactly |
| Pylon section says "not configured" | `PYLON_API_KEY` not set in Vercel |
| Pylon returns 401 | token was created by a non-admin user, or it's been revoked |
| Pylon returns 400 on `/issues` | the start/end window or param names changed — check current docs and update `lib/pylon.ts` |
| DB calls fail | `DATABASE_URL` is the wrong string (use the **pooled** one for serverless) or migration wasn't run |
