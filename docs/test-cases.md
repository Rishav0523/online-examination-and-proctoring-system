# Test cases and results

All results below were produced on **2026-10-31** on Windows (10.0.26200) with Node.js v24.18.0,
Wrangler local mode, D1 local storage and the development server on port 8788. They are recorded as
observed; nothing is projected or invented.

## 1. Type checking

| Command | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`, strict) | **Passed, no errors** |
| `npx wrangler deploy --dry-run` | **Passed**: 84 assets read, 99.55 KiB upload (21.35 KiB gzip), production vars and bindings resolved |

## 2. Automated API integration suite

Command:

```bash
TEST_ADMIN_EMAIL="<local admin email>" TEST_ADMIN_PASSWORD="<local admin password>" npm test
```

The suite talks to `http://127.0.0.1:8788`, keeps a real cookie jar per client, uses
`redirect: 'manual'`, sends real CSRF headers and creates unique records per run. The administrator
must already exist; credentials are supplied through the environment and are not stored in the
repository.

**Result: 30 of 30 groups passed.**

| # | Group | What is verified | Result |
| --- | --- | --- | --- |
| 1 | Health endpoint | `GET /api/health` returns `ok` | Pass |
| 2 | Anonymous session | No user, no CSRF token | Pass |
| 3 | Wrong admin password | `401 INVALID_CREDENTIALS`, no session cookie | Pass |
| 4 | Admin login cookie | Valid session; `HttpOnly`, `SameSite=Lax`, `Path=/`, not `Secure` on local HTTP, password absent | Pass |
| 5 | Admin dashboard | Numeric student count, chart series, recent events | Pass |
| 6 | Create draft exam | Draft created with schedule and settings | Pass |
| 7 | Publish without questions | `409 EXAM_NOT_READY` | Pass |
| 8 | Add question | Four options accepted, exactly one correct | Pass |
| 9 | Totals and lock state | Total marks and `canEditQuestions` update | Pass |
| 10 | Publish and activate | Exam becomes visible and startable | Pass |
| 11 | Student registration | `201`, student role, session cookie, CSRF token | Pass |
| 12 | Duplicate registration | `409 ACCOUNT_EXISTS` | Pass |
| 13 | Available exam list | State `available`, `canStart: true` | Pass |
| 14 | Start without consent | `422 CONSENT_REQUIRED` | Pass |
| 15 | Start with consent | One attempt created; second start resumes same ID | Pass |
| 16 | Attempt payload | Correct answers (`isCorrect`) not exposed | Pass |
| 17 | Answer persistence | Save then reload restores the answer | Pass |
| 18 | Proctoring event | `TAB_SWITCH` stored as medium, cooldown duplicate rejected | Pass |
| 19 | Submission | Server evaluates 1/1 as 100% pass; result null before release | Pass |
| 20 | Duplicate submission | `alreadySubmitted: true`; exactly one result row | Pass |
| 21 | Hidden results | Student results hidden and counted as pending | Pass |
| 22 | RBAC | Student receives `403 FORBIDDEN` on admin endpoint | Pass |
| 23 | CSRF | Missing header receives `403 CSRF_TOKEN_INVALID` | Pass |
| 24 | Origin check | Cross-site origin receives `403 CSRF_ORIGIN_MISMATCH` | Pass |
| 25 | Profile update | Updated values returned for the session | Pass |
| 26 | Proctoring review | Admin lists and reviews the event | Pass |
| 27 | Release results | `resultsPublished: true`; student sees exam ID, 1/1, 100%, pass | Pass |
| 28 | Password change | Other session is invalidated; the new password signs in; original password restored | Pass |
| 29 | Deactivation | Existing session gets `401`; login gets `403 ACCOUNT_DISABLED`; reactivation restores login | Pass |
| 30 | Password rate limit | 15 wrong change-password attempts produce at least one `429` | Pass |

Notes:

- The suite ends by changing the student password back and reactivating the account.
- The per-isolate rate limiter can remain saturated between runs; restart `npm run dev` before a
  repeat run.
- Test data uses a timestamp suffix (`Integration Exam <suffix>`) so runs do not collide.

## 3. Deployment-shape (sub-path) suite

Command:

```bash
npm run test:subpath
```

The suite spawns its own Worker on port 8789 with
`BASE_PATH=/projects/online-examination-and-proctoring-system` and stops it afterwards.

**Result: 10 of 10 checks passed.**

| # | Check | Result |
| --- | --- | --- |
| 1 | Prefix without trailing slash → `308` to prefix `/` | Pass |
| 2 | Home page `200`, HTML, `<base href="./">`, CSP, nosniff, `X-Frame-Options: DENY` | Pass |
| 3 | Nested admin page `200` with `<base href="../../">` | Pass |
| 4 | Nested path without slash → `308` to slash form | Pass |
| 5 | CSS asset `200` with `text/css` | Pass |
| 6 | Unknown page `404` with branded page and base rewritten to the prefix | Pass |
| 7 | Legacy spaced/mixed-case URL → `308` canonical prefix | Pass |
| 8 | Legacy nested URL → `308` canonical nested path | Pass |
| 9 | `/api/health` resolves under the prefix | Pass |
| 10 | Root portfolio paths (`/`, `/index.html`, `/assets/...`) return `404` from this Worker | Pass |

## 4. Manual browser walkthrough

Performed in a Chromium-based browser against the local server with the study exam already seeded.
This is a manual observation, not an automated claim.

| Scenario | Observed result | Status |
| --- | --- | --- |
| Admin publishes, schedules, activates an exam | Exam moved draft → published → active; student list updated | Pass |
| Student registration and login | Account created, signed in, dashboard populated | Pass |
| Consent gate | Start button disabled until consent; server rejects missing consent | Pass |
| Camera denied | Page explained the fallback and allowed the attempt to continue; no crash | Pass |
| Answer autosave and reload | Selected answer restored after page reload | Pass |
| Tab switch / window blur | Warning shown; events recorded and visible in admin proctoring list | Pass |
| Submit and hold results | Student saw pending state; admin saw attempt and evaluation | Pass |
| Review proctoring event | Status changed to reviewed with reviewer and timestamp | Pass |
| Release results | Student saw 1/1, 100%, Passed | Pass |
| Completed exam page | Completed state and result summary rendered | Pass |
| Student detail modal | Admin saw profile, attempts and result | Pass |
| Logout | Server session revoked; protected page redirected to login | Pass |

## 5. Security checks performed

| Control | Observation | Status |
| --- | --- | --- |
| Password storage | PBKDF2-SHA256 hash with salt; plaintext never stored | Verified by code/CLI |
| Session cookie flags | HTTP-only, SameSite, Secure in production, password absent | Automated |
| Session revocation | Logout, password change, deactivation, expiry | Automated |
| CSRF | Missing/invalid token and cross-site Origin rejected | Automated |
| Authorization | Student blocked from admin routes; admin login separate | Automated |
| SQL injection | Bound parameters throughout; no string interpolation of user values | Code review |
| XSS | Static pages use `textContent`/escaping helpers; CSP blocks inline script | Code review + CSP test |
| File exposure | Only `public/` is served; source, `.dev.vars`, migrations and tests are not | Sub-path test / config |
| Clickjacking | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` | Automated header check |

## 6. Production deployment verification

Deployed on 2026-10-31 to `https://rishavprasad.in/projects/online-examination-and-proctoring-system/`
using Cloudflare Worker `online-examination-and-proctoring-system` and D1 `oeps-db`. The wildcard
route was previously owned by the older `vidya-suraksha` Worker; it was reassigned, and the old
Worker was retained in the account.

| Check | Observed | Result |
| --- | --- | --- |
| Prefix without trailing slash | `308` to the canonical slash URL | Pass |
| Home page | `200`, correct title and Royal Bengal assets | Pass |
| `/api/health` | `200`, `{"ok":true,"data":{"status":"ok",...}}` | Pass |
| CSS asset | `200 text/css` | Pass |
| `/auth/admin/`, `/auth/login/`, `/auth/register/` | `200` | Pass |
| Admin login | `200`; cookie `Path=/; SameSite=Lax; HttpOnly; Secure; Max-Age=43200` | Pass |
| Authenticated admin dashboard | `ok: true` with live statistics | Pass |
| Portfolio root | `200`, original portfolio title and content | Pass |
| Old Worker route | Reassigned; old Worker not deleted | Pass |

No production credential is recorded here. The administrator password was generated for the
deployment and is stored only as a PBKDF2 hash; it should be changed after first sign-in.

## 7. Not tested / limitations

- **Production load, failover and cross-browser behaviour** beyond the smoke test above were not
  benchmarked. D1 and Worker limits were not stress-tested.
- **Concurrency testing** beyond duplicate submission was not run. D1 and Worker limits were not
  benchmarked.
- **Face detection accuracy** was not measured. The automated/manual runs exercised camera-denial
  fallback and browser events, not precision/recall of the face model with varied lighting, faces
  or occlusion.
- **Cross-browser** verification was limited to Chromium. Firefox/Safari camera and fullscreen
  behaviour may differ.
- **Global rate limiting** is not provided; buckets are per Worker isolate and reset on redeploy.
- **Proctoring coverage** is inherently partial: the browser cannot detect other OS applications,
  physical devices or off-camera assistance. Signals are review aids, not proof.

## 8. Reproducing the automated run

1. `npm install`
2. `cp .dev.vars.example .dev.vars`
3. `npm run db:migrate:local`
4. `node scripts/create-admin.mjs --name "Test Administrator" --email "test-admin@example.edu"`
5. `npm run dev`
6. In a second terminal:
   `TEST_ADMIN_EMAIL="test-admin@example.edu" TEST_ADMIN_PASSWORD="<the password you chose>" npm test`
7. `npm run test:subpath`

The test suites create data in the local D1 database only. They do not touch Cloudflare or the
portfolio.
