# Deployment guide

This guide deploys the Worker to **your** Cloudflare account and mounts it under
`https://rishavprasad.in/projects/online-examination-and-proctoring-system/`. The existing
portfolio at `https://rishavprasad.in/` keeps its current configuration.

## Current deployment (31 October 2026)

| Item | Value |
| --- | --- |
| Public URL | `https://rishavprasad.in/projects/online-examination-and-proctoring-system/` |
| Worker | `online-examination-and-proctoring-system` |
| Database | `oeps-db` (`3f2e22d6-cd13-4abb-9cc1-6d4e8c458667`, binding `DB`) |
| Zone | `rishavprasad.in` |
| Routes | exact prefix + `/projects/online-examination-and-proctoring-system/*` |
| Previous route owner | `vidya-suraksha` was unassigned from the wildcard route; the Worker remains in the account |
| Portfolio | `rishav-portfolio` is unchanged and still serves `https://rishavprasad.in/` |
| Administrator | provisioned with `scripts/create-admin.mjs --remote`; credentials are not stored in this repository |

Production smoke checks passed: prefix `308` redirect, home page `200`, API health `ok`, admin
login with `Secure`/`HttpOnly`/`SameSite=Lax` cookie, authenticated dashboard response, and the
portfolio root returning its normal page. To redeploy after a code change, run
`npx wrangler deploy`; the routes in `wrangler.jsonc` are already attached.

> Do not paste secrets into source files or chat. Account-specific values live only in
> `wrangler.jsonc` (non-secret identifiers) and local Wrangler authentication.

## 1. Prerequisites

- A GitHub account (repository hosting) and a Cloudflare account that manages the
  `rishavprasad.in` zone.
- Node.js 20+ and npm installed locally.
- Wrangler authenticated through the browser (`wrangler login`). Use OAuth; do not create a
  long-lived API token for routine deploys.

## 2. Verify locally before deploying

```bash
cd "C:/Users/Rishav Prasad/Documents/Qoder/2026-10-31/3eadbc65"
npm ci
npm run typecheck
npm run test:subpath
```

For the API suite, start `npm run dev` in another terminal and use a local administrator created
with `node scripts/create-admin.mjs` (see README). Recorded results are in
[test-cases.md](test-cases.md).

## 3. Publish the source to GitHub

Create an empty repository in the GitHub web UI (no README, no .gitignore), then run:

```bash
cd "C:/Users/Rishav Prasad/Documents/Qoder/2026-10-31/3eadbc65"
git init
git add .
git status
```

Inspect `git status` before committing. `.gitignore` excludes `node_modules/`, `.wrangler/`,
`.dev.vars`, `.env*`, build output, logs and editor folders. Never stage `.dev.vars`.

```bash
git commit -m "Build online examination and proctoring system"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repository>.git
git push -u origin main
```

The repository is now ready for GitHub-based deployment. You can also deploy straight from the
local working tree with Wrangler; both paths are valid.

## 4. Create the D1 database

The production deployment already uses `oeps-db`; its ID is set in `wrangler.jsonc`. For a fresh
account or a different environment:

```bash
npx wrangler login
npx wrangler d1 create oeps-db
```

Wrangler prints a `database_id`. Copy that value — do not invent or guess one — and replace the
`database_id` in `wrangler.jsonc`. If you choose a different database name, update both
`wrangler.jsonc` and `DB_NAME` in `scripts/create-admin.mjs`.

## 5. Apply migrations

```bash
npm run db:migrate:remote
```

This runs `wrangler d1 migrations apply DB --remote` against the `DB` binding. Confirm with:

```bash
npx wrangler d1 execute oeps-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expected tables: `users`, `sessions`, `exams`, `questions`, `options`, `exam_attempts`,
`student_answers`, `results`, `proctoring_logs`.

## 6. Create the administrator

There is no default administrator and no public admin registration.

```bash
node scripts/create-admin.mjs --remote --name "Exam Administrator" --email "you@example.edu"
```

The script prompts for the password twice with hidden input and stores only a PBKDF2 hash. If you
must run non-interactively, set `ADMIN_PASSWORD` for that single command and then clear it; passing
`--password` can leave the value in shell history. Never commit the password or a `.dev.vars` file.

## 7. Deploy the Worker

```bash
npx wrangler deploy
```

Wrangler uploads `src/index.ts`, the D1 binding and `public/` assets. With the `routes` block in
`wrangler.jsonc`, Wrangler also attaches the custom-domain routes; if another Worker owns them,
resolve the conflict in the next section. The current deployment already has both routes attached.

Check the deployment shape without publishing:

```bash
npx wrangler deploy --dry-run
```

## 8. Attach the custom-domain route

In the Cloudflare dashboard: **Workers & Pages → your Worker → Settings → Domains & Routes → Add
route**. Add these two routes for the zone `rishavprasad.in`:

```text
rishavprasad.in/projects/online-examination-and-proctoring-system
rishavprasad.in/projects/online-examination-and-proctoring-system/*
```

Why this is safe for the portfolio:

- Worker routes are **literal path prefixes**; only those paths are intercepted.
- Do **not** add `rishavprasad.in/*` or any route that covers the portfolio.
- No nameserver, DNS record or portfolio configuration change is required. Do not change them.
- The Worker rejects any request whose path is outside `BASE_PATH`, returning `404`.

Route ownership: a route can belong to only one Worker. The original deployment found the wildcard
route assigned to an older Worker named `vidya-suraksha`. That route was reassigned to
`online-examination-and-proctoring-system`; `vidya-suraksha` remains deployed but no longer serves
this path. If Wrangler reports “Can't deploy routes that are assigned to another worker”, reassign
the existing route in the dashboard (or detach it from the old Worker) before deploying. Do not
delete the old Worker unless you are certain it is obsolete.

If the Worker should also answer `www.rishavprasad.in`, add equivalent routes for that hostname
only if the zone and certificate already cover it; otherwise keep the canonical host as above.

### Legacy spaced URL

The Worker redirects the old spaced/mixed-case form to the canonical prefix:

```text
/projects/Online%20Examination%20and%20Proctoring%20System/...
  → 308 /projects/online-examination-and-proctoring-system/...
```

A route is required for the Worker to receive that path. If old links are still in circulation,
add one optional route:

```text
rishavprasad.in/projects/Online*
```

The wildcard must stay at the end. This route only matches paths under `/projects/Online`, so the
portfolio and other projects are unaffected. If no old links exist, skip it.

## 9. Post-deployment verification

Run these from Git Bash, replacing nothing except the host if you use a staging domain:

```bash
curl -sI https://rishavprasad.in/projects/online-examination-and-proctoring-system | head -5
curl -s  https://rishavprasad.in/projects/online-examination-and-proctoring-system/api/health
curl -s  https://rishavprasad.in/projects/online-examination-and-proctoring-system/ -o /dev/null -w "%{http_code}\n"
curl -sI "https://rishavprasad.in/projects/Online%20Examination%20and%20Proctoring%20System/" | head -5
```

Expected: `308` to the trailing-slash URL for the prefix, `{"ok":true,"data":{"status":"ok",...}}`
for health, `200` for the home page and `308` to the canonical prefix for the legacy URL (only if
the optional route is attached).

Recorded on 31 October 2026 for the current deployment: prefix `308`, home `200`, API health `ok`,
admin login `200` with a `Secure`/`HttpOnly`/`SameSite=Lax` cookie, authenticated dashboard `ok`,
portfolio root `200` with the original portfolio title. The spaced URL route was not attached
because no old links require it.

Then in a browser:

1. Open the public home page and follow “Student Login”.
2. Register a disposable student account.
3. Sign in at the administrator URL with the account created in step 6.
4. Create a draft exam, add a four-option question, publish and activate it.
5. In browser developer tools, confirm the `oeps_session` cookie is `HttpOnly`, `Secure` and
   `SameSite=Lax`.
6. Take the exam in a second browser profile, submit, release results as admin and confirm the
   student sees them.
7. Open `https://rishavprasad.in/` and confirm the portfolio is unchanged.

## 10. Environment variables and secrets

| Name | Where | Value |
| --- | --- | --- |
| `APP_ENV` | `wrangler.jsonc` vars | `production` |
| `BASE_PATH` | `wrangler.jsonc` vars | `/projects/online-examination-and-proctoring-system` |
| `SESSION_TTL_HOURS` | `wrangler.jsonc` vars | `12` |
| `SESSION_TTL_REMEMBER_HOURS` | `wrangler.jsonc` vars | `720` |
| `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` | shell only, for tests | your local test admin; never commit |
| `ADMIN_PASSWORD` | shell only, optional one-shot admin creation | never commit |

`wrangler secret put` is not required for this application. If you later add a secret, keep it out
of `wrangler.jsonc`, `.dev.vars.example` and Git history.

## 11. Rollback and operations

- View live logs: `npx wrangler tail`.
- List deployments: `npx wrangler deployments list`; roll back to a previous version from the
  dashboard (**Deployments → version → Rollback**) or with Wrangler's rollback command.
- Database changes are not rolled back automatically. Take a D1 export/backup before applying a
  destructive migration.
- Free-tier limits apply (requests, CPU time, D1 rows/reads/writes). The app is designed to stay
  within a small college workload.

## 12. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `database_id` invalid or D1 errors | Replace the placeholder with the real ID from step 4 and redeploy |
| Home page 404, API 200 | `BASE_PATH` missing or different from the route; set it exactly and redeploy |
| Assets 404 under the prefix | Keep `assets.run_worker_first: true`; `public/` must be committed |
| Login works but session drops | You are on HTTP or `APP_ENV` is not `production`; Secure cookies require HTTPS |
| `CSRF_TOKEN_INVALID` | Reload the page; the browser is sending an old session token |
| Rate limit during testing | The limiter is per isolate and in memory; wait for the window or redeploy |
| Old spaced URL 404 | Attach the optional `/projects/Online*` route; the redirect code is already deployed |
| Portfolio changed | Remove any broad `rishavprasad.in/*` route; only the project prefix routes should exist |
| Face detection unavailable | Camera permission denied or model blocked; the exam still works, the UI reports the fallback |
