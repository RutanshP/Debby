# Debby v2 — Deploy Runbook

This is the cutover from the legacy Flask + vanilla JS app to the new
**FastAPI (apps/api) on Railway** + **Next.js (apps/web) on Vercel** stack
backed by Supabase. Follow it in order; each step is idempotent.

Prerequisites you control:
- A Supabase project (free tier is fine)
- A Railway account
- A Vercel account
- An OpenAI API key and an AssemblyAI API key

Repo state: this lives on `main` once integration/v2 is merged. The last
Flask-only revision is tagged `legacy-flask`.

---

## 1. Supabase

1. Create a new project at https://supabase.com/dashboard. Pick a strong DB password and save it.
2. Once provisioned, go to **Settings → API** and copy:
   - **Project URL** → this is `SUPABASE_URL` (also `NEXT_PUBLIC_SUPABASE_URL`)
   - **anon public** key → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → this is `SUPABASE_SERVICE_ROLE_KEY` (server-only; never expose to the browser)
3. **Settings → API → JWT Settings → JWT Secret** → this is `SUPABASE_JWT_SECRET`
4. **Authentication → Providers**: enable Email; turn off "Confirm email" while you smoke-test if you want frictionless signup.
5. **SQL Editor → New query**: paste the contents of `apps/api/migrations/0001_init.sql` and run it. Verify the `rounds`, `drills`, and `speed_passages` tables appear under **Database → Tables**, each with RLS enabled.
6. Run `apps/api/migrations/0002_seed_speed_passages.sql` the same way (this seeds the speed-drill passages).
7. **Database → Tables → rounds → RLS**: verify policies are active. Same for `drills`. `speed_passages` should have a public read policy.

## 2. Railway (FastAPI backend)

1. New project → Deploy from GitHub repo → pick `gurnoorssandhu/Debby`.
2. In service **Settings → Service**:
   - **Root Directory**: `apps/api`  ← important; otherwise Railway tries to build the Flask app
   - Builder: NIXPACKS (default; auto-detected from `pyproject.toml`)
   - Start Command (if not auto-detected): `uvicorn main:app --host 0.0.0.0 --port $PORT`
3. **Variables** (Settings → Variables → Raw editor):
   ```
   OPENAI_API_KEY=sk-...
   ASSEMBLYAI_API_KEY=...
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   SUPABASE_JWT_SECRET=...
   ALLOWED_ORIGINS=https://<your-vercel-domain>.vercel.app,http://localhost:3000
   ```
4. Deploy. After it goes green, hit `https://<railway-domain>/healthz` — you should see `{"status":"ok"}`.
5. Note the public Railway domain — it's `NEXT_PUBLIC_API_BASE_URL` for Vercel.

## 3. Vercel (Next.js frontend)

1. New project → Import Git Repository → pick `gurnoorssandhu/Debby`.
2. **Configure project**:
   - Framework Preset: Next.js (auto-detected via `vercel.json`)
   - Root Directory: leave blank — `vercel.json` already points the build at `apps/web/`.
3. **Environment Variables** (Production, Preview, Development):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   NEXT_PUBLIC_API_BASE_URL=https://<railway-domain>
   ```
4. Deploy. Once the build is green, visit `/login` — Supabase auth UI should render.
5. **Important:** go back to Railway and update `ALLOWED_ORIGINS` to include the final Vercel domain (and your custom domain if you set one).

## 4. Smoke test

This is the multi-user isolation regression test for the global-state bug the refactor was built to fix.

1. **Browser A (Chrome)**: sign up as `user-a@example.com`. Run a round end-to-end: pick a parli topic → record affirmative speech → watch AI opposition stream in → record rebuttal → see RFD + flow → confirm it lands in `/history`.
2. **Browser B (Safari, or Chrome incognito)**: sign up as `user-b@example.com` *simultaneously* (overlap the recording steps). Run a round.
3. After both finish: each `/history` should show only that user's round. No transcript, RFD, or flow should appear cross-account.
4. Drills (`/drills`): generate one of each of the four drill types; submit a text response on the rebuttal drill; submit a recording on the speed drill.
5. Case builder (`/parli-gpt`): generate a Parli case for `aff`, then a random MSPDP case.

If any of those steps fail with 401: re-check that the Railway `SUPABASE_JWT_SECRET` matches Supabase's JWT secret exactly (no trailing newline).

## 5. Decommission the Flask app

The legacy code under `backend/`, `static/`, `templates/`, `main.py`, `data/` (CSVs + speed_passages.json) stays in the repo for now.

- The `legacy-flask` tag points at the last Flask-only commit (`3580ad6`). You can always check it out with `git checkout legacy-flask`.
- If you had a separate Railway service running the Flask app, pause or delete it.
- Once you're satisfied v2 is stable in production for ~1 week, you can remove the legacy directories in a follow-up cleanup PR. Suggested deletions:
  ```
  backend/
  static/
  templates/
  main.py
  Procfile         # only the root one; apps/api/Procfile stays
  requirements.txt # legacy Flask deps
  data/parlires.csv data/msres.csv data/speed_passages.json  # now bundled in apps/api/data/
  ```

## 6. Operational notes

- **Railway logs** are the first place to look on a 5xx. AssemblyAI rate-limit errors surface as 502 from `/api/rounds/<id>/speeches`.
- **Cost knobs**: OpenAI is the biggest line item. The shared `AsyncOpenAI` client in `apps/api/services/openai_client.py` is the only place credentials are read.
- **CORS**: any new Vercel preview URL needs to be in `ALLOWED_ORIGINS`. The simplest pattern is to add `*.vercel.app` if you trust your team; otherwise pin specific deploys.
- **Rolling back**: revert the latest commit on `main` and re-deploy. The legacy Flask app is also reachable via `git checkout legacy-flask` if you ever need the old behaviour standalone.
