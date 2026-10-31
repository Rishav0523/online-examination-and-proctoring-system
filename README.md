# Online Examination & Proctoring System

A complete digital examination portal for a college environment: timed attempts, server-side
evaluation, browser-based proctoring signals and an administrator console — built on Cloudflare
Workers, D1 and static assets, styled in a Royal Bengal palette.

**Live deployment:** `https://rishavprasad.in/projects/online-examination-and-proctoring-system/`
**Portfolio at `https://rishavprasad.in/` remains unaffected.** All Worker routes and the base path
are scoped to the `/projects/...` prefix. See [docs/deployment-guide.md](docs/deployment-guide.md).

> Deployed to Cloudflare on **31 October 2026**. The production Worker, D1 database, migrations,
> scoped routes and administrator account are provisioned. Local automated tests and a production
> smoke test passed. The deployment guide remains the source of truth for redeploying or rolling back.

## Features

- Student registration and login by email or student ID; separate administrator login.
- Secure sessions: HTTP-only cookies, `Secure` in production, `SameSite=Lax`, CSRF token,
  origin checks, fixed expiry and server-side session revocation.
- Role-based access control (student / admin) enforced in the Worker, not the browser.
- Administrator dashboard with live D1 statistics and Chart.js series.
- Student management, exam CRUD, scheduling, activation, safe deletion rules.
- Question bank with exactly four options per MCQ, exactly one correct answer, marks and ordering.
- Timed attempt engine with server-authoritative expiry, answer autosave and restore,
  auto-submit, resubmission protection and server-side evaluation.
- Results remain hidden until the administrator explicitly releases them.
- Browser proctoring: face presence, multiple faces, camera disconnection, tab/window changes and
  fullscreen exit. Explicit consent, visible warnings, no recordings by default.
- Normalised D1 schema with foreign keys, checks, unique constraints and indexes.
- Deployment-shape tests for the sub-path, trailing-slash canonicalisation, legacy spaced URLs and
  portfolio isolation.

## Technology

| Layer | Choice |
| --- | --- |
| Frontend | HTML5, CSS3, vanilla JavaScript, Bootstrap 5, Bootstrap Icons, Chart.js |
| Backend | TypeScript on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) with versioned migrations |
| Face detection | face-api.js (`@vladmandic/face-api`) with a locally bundled Tiny Face Detector model |
| Tests | Node.js test harnesses (`tests/integration.mjs`, `tests/subpath.mjs`) |
| Tooling | Wrangler 4, TypeScript strict mode |

No Flask, Django, PHP, MySQL, MongoDB, Firebase, Supabase, Render, Railway or Vercel is used.

## Repository layout

```text
public/                 Static frontend (home, auth, student, admin, assets, face model)
src/                    Worker entry, router, middleware, modules, services
  config/               Environment helpers (base path, session TTL, grace period)
  database/             Row mappers and query helpers
  middleware/           Authentication, authorisation, CSRF, rate limiting, validation
  modules/              Route modules: auth, admin, examinations, questions, students, results, proctoring
  services/             Business logic and SQL
  utils/                HTTP envelope, crypto, time, query params
migrations/             Versioned D1 migrations
database/schema.sql     Schema snapshot for reading and reviews
scripts/create-admin.mjs  CLI that hashes and inserts a new administrator
tests/                  API integration and deployment sub-path test suites
docs/                   Report, architecture, database design, deployment, user manual, test cases
```

## Local setup

Prerequisites: Node.js 20 or newer, npm, and a Chromium-based browser for the proctoring UI.

1. Install dependencies.

   ```bash
   cd "C:/Users/Rishav Prasad/Documents/Qoder/2026-10-31/3eadbc65"
   npm install
   ```

2. Create the local environment file.

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   `.dev.vars` is gitignored. It sets `APP_ENV=development` and an empty `BASE_PATH`, so the app is
   served at `http://localhost:8788/`.

3. Apply the database schema to the local D1 database.

   ```bash
   npm run db:migrate:local
   ```

4. Create an administrator. Credentials are never hardcoded and no default admin exists; the CLI
   prompts for the password with hidden input.

   ```bash
   node scripts/create-admin.mjs --name "Exam Administrator" --email "you@example.edu"
   ```

5. Start the development server.

   ```bash
   npm run dev
   ```

6. Open `http://localhost:8788/` for the public site, `http://localhost:8788/auth/admin/` for the
   administrator console and `http://localhost:8788/auth/login/` for students.

## Configuration

| Variable | Purpose | Local | Production |
| --- | --- | --- | --- |
| `APP_ENV` | Enables Secure cookies, HSTS and production error messages | `development` | `production` |
| `BASE_PATH` | URL prefix stripped before routing | empty | `/projects/online-examination-and-proctoring-system` |
| `SESSION_TTL_HOURS` | Standard session lifetime | 12 (default) | 12 |
| `SESSION_TTL_REMEMBER_HOURS` | “Remember me” session lifetime | 720 (default) | 720 |

Database binding: `DB`. Static assets binding: `ASSETS`. Do not commit `.dev.vars`, API tokens,
production passwords or private keys.

## Tests

Run the type checker first:

```bash
npm run typecheck
```

Start the dev server, then run the API suite. The suite needs an existing local administrator
account and creates its own exam, student and attempt with a unique suffix.

```bash
TEST_ADMIN_EMAIL="you@example.edu" TEST_ADMIN_PASSWORD="your-local-password" npm test
```

Run the deployment-shape suite (it spawns its own Worker on port 8789 with the production
`BASE_PATH`):

```bash
npm run test:subpath
```

Latest recorded results (2026-10-31): type check passed, **30/30 integration groups passed**,
**10/10 sub-path checks passed**, and the production smoke test passed (home, API health, admin
login with `Secure`/`HttpOnly` cookie, authenticated dashboard, unaffected portfolio root). Details
and reproducible cases are in [docs/test-cases.md](docs/test-cases.md). The rate limiter is per
Worker isolate; restart the dev server to clear a saturated bucket.

## Security notes

- Passwords are hashed with PBKDF2-SHA256 (100,000 iterations, per-user random salt).
- Session tokens are random, stored only as SHA-256 hashes, and delivered in an HTTP-only cookie.
- Mutating API requests require a same-origin request and the session-bound CSRF header.
- All SQL uses prepared statements with bound parameters.
- Browser proctoring observes the camera stream and page visibility only. It cannot detect every
  operating-system application, physical device or person outside the frame. Results are signals
  for human review, not proof of misconduct, and false positives are possible.

## Documentation

- [Project report](docs/project-report.md) — objectives, analysis, design diagrams, testing, limitations.
- [Architecture](docs/architecture.md) — request flow, routing, auth, timing, proctoring, API reference.
- [Database design](docs/database-design.md) — ER model, constraints, indexes, data lifecycle.
- [Deployment guide](docs/deployment-guide.md) — GitHub, Cloudflare, D1, routes, custom sub-path.
- [User manual](docs/user-manual.md) — student and administrator workflows.
- [Test cases](docs/test-cases.md) — automated and manual results, limitations.
