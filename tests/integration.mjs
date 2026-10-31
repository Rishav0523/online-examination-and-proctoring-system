#!/usr/bin/env node
/**
 * End-to-end API integration tests for the Online Examination System.
 *
 * Runs against a local `wrangler dev` server (default http://127.0.0.1:8788).
 * The tests create their own examination and student, so no fixtures are
 * required beyond an administrator account created with the CLI:
 *
 *   ADMIN_NAME="Local Test Admin" \
 *   ADMIN_EMAIL="test-admin@example.edu" \
 *   npm run admin:create
 *
 * The CLI prompts for the password. Then start the dev server and run:
 *
 *   TEST_ADMIN_EMAIL=test-admin@example.edu \
 *   TEST_ADMIN_PASSWORD="<the password you chose>" \
 *   npm test
 *
 * The suite leaves its generated examination/student rows in the local D1
 * database so results can be inspected in the UI afterwards.
 */

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    'TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD must be set.\n' +
      'Create a local administrator first:\n\n' +
      '  ADMIN_NAME="Local Test Admin" ADMIN_EMAIL="test-admin@example.edu" \\\n' +
      '  npm run admin:create\n\n' +
      'Then rerun with the same email and password in TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD.',
  );
  process.exit(1);
}

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const results = [];
let passed = 0;

class Client {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
    this.csrf = null;
    this.lastSetCookie = [];
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  captureCookies(response) {
    const values = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    this.lastSetCookie = values;
    for (const value of values) {
      const pair = value.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

async function request(client, method, path, options = {}) {
  const headers = {
    Accept: 'application/json',
    Origin: BASE,
    ...(options.headers || {}),
  };
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  if (options.csrf !== false && client && client.csrf) headers['X-CSRF-Token'] = client.csrf;
  if (client && client.cookies.size) headers.Cookie = client.cookieHeader();

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    redirect: 'manual',
  });
  if (client) client.captureCookies(response);

  const text = await response.text();
  let body = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json') && text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path} returned invalid JSON: ${text.slice(0, 200)}`);
    }
  }
  return { status: response.status, headers: response.headers, body, text };
}

function fail(message, extra) {
  const detail = extra === undefined ? '' : `\n  ${JSON.stringify(extra, null, 2)}`;
  throw new Error(`${message}${detail}`);
}

function check(condition, message, extra) {
  if (!condition) fail(message, extra);
}

function equal(actual, expected, message) {
  if (actual !== expected) fail(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function expectOk(response, label) {
  if (response.status < 200 || response.status >= 300) {
    fail(`${label} failed with HTTP ${response.status}`, response.body || response.text.slice(0, 300));
  }
  check(response.body && response.body.ok === true, `${label} did not return ok:true`, response.body);
  return response.body.data;
}

function expectError(response, status, code, label) {
  equal(response.status, status, `${label} returned the wrong status`);
  check(response.body && response.body.ok === false, `${label} did not return ok:false`, response.body);
  if (code) equal(response.body.error && response.body.error.code, code, `${label} returned the wrong error code`);
  return response.body.error;
}

async function step(label, fn) {
  process.stdout.write(`  • ${label} … `);
  try {
    await fn();
    passed += 1;
    results.push({ label, ok: true });
    process.stdout.write('ok\n');
  } catch (error) {
    results.push({ label, ok: false, error });
    process.stdout.write('FAILED\n');
    throw error;
  }
}

async function main() {
  let health;
  try {
    health = await fetch(`${BASE}/api/health`, { headers: { Accept: 'application/json' } });
  } catch (error) {
    console.error(`Cannot reach ${BASE}. Start the dev server with "npm run dev" first.`);
    console.error(String(error && error.message ? error.message : error));
    process.exit(1);
  }
  if (!health.ok) {
    console.error(`${BASE}/api/health returned HTTP ${health.status}. Start the dev server with "npm run dev".`);
    process.exit(1);
  }

  console.log(`\nIntegration tests against ${BASE}\n`);

  const admin = new Client('admin');
  const student = new Client('student');
  const studentB = new Client('student-b');
  const studentC = new Client('student-c');
  const anonymous = new Client('anonymous');

  const studentEmail = `integration.${suffix}@example.edu`;
  const studentStudentId = `TST${suffix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)}`;
  const studentPassword = 'StudentPass123';
  const updatedPassword = 'StudentPass456';
  let exam;
  let question;
  let correctOptionId;
  let attempt;

  await step('health endpoint reports ok', async () => {
    const response = await request(anonymous, 'GET', '/api/health');
    const data = expectOk(response, 'health');
    equal(data.status, 'ok', 'health status');
  });

  await step('anonymous session has no user', async () => {
    const response = await request(anonymous, 'GET', '/api/auth/session');
    const data = expectOk(response, 'session');
    equal(data.user, null, 'anonymous user');
    equal(data.csrfToken, null, 'anonymous csrf token');
  });

  await step('admin login rejects a wrong password', async () => {
    const response = await request(anonymous, 'POST', '/api/auth/admin/login', {
      json: { identifier: ADMIN_EMAIL, password: `${ADMIN_PASSWORD}-wrong` },
    });
    expectError(response, 401, 'INVALID_CREDENTIALS', 'admin login with wrong password');
    check(response.headers.getSetCookie().every((value) => !/oeps_session=[^;]+/.test(value)) || response.headers.getSetCookie().length === 0,
      'a failed login must not create a session cookie');
  });

  await step('admin login sets a hardened session cookie', async () => {
    const response = await request(admin, 'POST', '/api/auth/admin/login', {
      json: { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const data = expectOk(response, 'admin login');
    equal(data.user.role, 'admin', 'admin role');
    check(typeof data.csrfToken === 'string' && data.csrfToken.length >= 32, 'csrf token is issued');
    admin.csrf = data.csrfToken;
    check(admin.cookies.has('oeps_session'), 'session cookie is stored');
    const cookie = admin.lastSetCookie.join('\n');
    check(/HttpOnly/i.test(cookie), 'session cookie must be HttpOnly', cookie);
    check(/SameSite=Lax/i.test(cookie), 'session cookie must be SameSite=Lax', cookie);
    check(/Path=\//i.test(cookie), 'session cookie must be scoped to /', cookie);
    check(!/Secure/i.test(cookie), 'local HTTP dev cookies must not be marked Secure', cookie);
    check(!cookie.includes(ADMIN_PASSWORD), 'password must never appear in a cookie');
  });

  await step('admin dashboard returns live statistics', async () => {
    const response = await request(admin, 'GET', '/api/admin/dashboard');
    const data = expectOk(response, 'admin dashboard');
    check(data.stats && typeof data.stats.totalStudents === 'number', 'dashboard has student count');
    check(Array.isArray(data.charts.attemptsByExam), 'dashboard has chart series');
    check(Array.isArray(data.recentEvents), 'dashboard has recent events');
  });

  await step('admin creates a draft examination', async () => {
    const now = Date.now();
    const response = await request(admin, 'POST', '/api/admin/exams', {
      json: {
        title: `Integration Exam ${suffix}`,
        subject: 'Integration Testing',
        description: 'Automated end-to-end verification examination.',
        duration: 15,
        passingMarks: 1,
        startTime: new Date(now - 5 * 60 * 1000).toISOString(),
        endTime: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
        instructions: 'Automated test. Select the correct option.',
      },
    });
    const data = expectOk(response, 'create exam');
    exam = data.exam;
    equal(exam.status, 'draft', 'new examination status');
    equal(exam.totalMarks, 0, 'new examination total marks');
    check(Array.isArray(data.questions) && data.questions.length === 0, 'new examination has no questions');
  });

  await step('publishing without questions is blocked', async () => {
    const response = await request(admin, 'PATCH', `/api/admin/exams/${exam.id}`, {
      json: { status: 'published' },
    });
    expectError(response, 409, 'EXAM_NOT_READY', 'publish empty examination');
  });

  await step('admin adds a four-option question with one correct answer', async () => {
    const response = await request(admin, 'POST', `/api/admin/exams/${exam.id}/questions`, {
      json: {
        text: `Which option is correct for ${suffix}?`,
        marks: 1,
        options: ['First option', 'Second option', 'Third option', 'Fourth option'],
        correctIndex: 2,
      },
    });
    question = expectOk(response, 'add question');
    const correct = question.options.filter((option) => option.isCorrect);
    equal(question.options.length, 4, 'question option count');
    equal(correct.length, 1, 'exactly one correct option');
    equal(correct[0].text, 'Third option', 'correct option text');
    correctOptionId = correct[0].id;
  });

  await step('examination totals and lock state update', async () => {
    const response = await request(admin, 'GET', `/api/admin/exams/${exam.id}`);
    const data = expectOk(response, 'admin exam detail');
    equal(data.exam.totalMarks, 1, 'total marks after adding a question');
    equal(data.questions.length, 1, 'question count');
    equal(data.canEditQuestions, true, 'questions editable before attempts');
  });

  await step('examination can be published and activated', async () => {
    let response = await request(admin, 'PATCH', `/api/admin/exams/${exam.id}`, {
      json: { status: 'published' },
    });
    equal(expectOk(response, 'publish exam').exam.status, 'published', 'published status');

    response = await request(admin, 'PATCH', `/api/admin/exams/${exam.id}`, {
      json: { status: 'active' },
    });
    equal(expectOk(response, 'activate exam').exam.status, 'active', 'active status');
  });

  await step('public registration creates a student session', async () => {
    const response = await request(student, 'POST', '/api/auth/register', {
      json: {
        fullName: `Integration Student ${suffix}`,
        studentId: studentStudentId,
        email: studentEmail,
        department: 'Software Testing',
        semester: '3',
        password: studentPassword,
        confirmPassword: studentPassword,
      },
      csrf: false,
    });
    const data = expectOk(response, 'student registration');
    equal(data.user.role, 'student', 'registered role');
    check(student.cookies.has('oeps_session'), 'registration creates a session');
    check(typeof data.csrfToken === 'string', 'registration returns a csrf token');
    student.csrf = data.csrfToken;
    student.user = data.user;
  });

  await step('duplicate registration is rejected', async () => {
    const other = new Client('duplicate');
    const response = await request(other, 'POST', '/api/auth/register', {
      json: {
        fullName: 'Duplicate Student',
        studentId: `DUP${suffix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}`,
        email: studentEmail,
        department: 'Software Testing',
        semester: '3',
        password: studentPassword,
        confirmPassword: studentPassword,
      },
      csrf: false,
    });
    expectError(response, 409, 'ACCOUNT_EXISTS', 'duplicate registration');
  });

  await step('student sees the active examination as available', async () => {
    const response = await request(student, 'GET', '/api/student/exams');
    const data = expectOk(response, 'student exams');
    const item = data.items.find((entry) => entry.id === exam.id);
    check(Boolean(item), 'exam is listed for the student');
    equal(item.state, 'available', 'exam state');
    equal(item.canStart, true, 'exam can start');
  });

  await step('starting without consent is rejected', async () => {
    const response = await request(student, 'POST', `/api/student/exams/${exam.id}/start`, {
      json: { consent: false },
    });
    expectError(response, 422, 'CONSENT_REQUIRED', 'start without consent');
  });

  await step('starting with consent creates exactly one attempt', async () => {
    let response = await request(student, 'POST', `/api/student/exams/${exam.id}/start`, {
      json: { consent: true },
    });
    const first = expectOk(response, 'start attempt');
    check(Number.isInteger(first.attemptId), 'attempt id is returned');
    equal(first.resumed, false, 'first attempt is new');
    check(first.remainingSeconds > 0 && first.remainingSeconds <= 15 * 60, 'remaining time is within duration');
    attempt = first;

    response = await request(student, 'POST', `/api/student/exams/${exam.id}/start`, {
      json: { consent: true },
    });
    const second = expectOk(response, 'resume attempt');
    equal(second.attemptId, first.attemptId, 'resumed attempt id');
    equal(second.resumed, true, 'second start resumes the same attempt');
  });

  await step('attempt payload hides correct answers', async () => {
    const response = await request(student, 'GET', `/api/student/attempts/${attempt.attemptId}`);
    const data = expectOk(response, 'load attempt');
    equal(data.finished, false, 'attempt is in progress');
    equal(data.questions.length, 1, 'attempt question count');
    for (const option of data.questions[0].options) {
      check(!('isCorrect' in option), 'student payload must not expose isCorrect');
    }
    for (const key of Object.keys(data.answers)) {
      check(data.answers[key] === null || typeof data.answers[key] === 'number', 'answer map values');
    }
  });

  await step('answer saves and restores after a reload', async () => {
    let response = await request(student, 'PUT', `/api/student/attempts/${attempt.attemptId}/answers/${question.id}`, {
      json: { optionId: correctOptionId },
    });
    const saved = expectOk(response, 'save answer');
    equal(saved.optionId, correctOptionId, 'saved option id');

    response = await request(student, 'GET', `/api/student/attempts/${attempt.attemptId}`);
    const data = expectOk(response, 'reload attempt');
    equal(data.answers[String(question.id)] ?? data.answers[question.id], correctOptionId, 'restored answer');
  });

  await step('proctoring events are recorded with a cooldown', async () => {
    let response = await request(student, 'POST', `/api/student/attempts/${attempt.attemptId}/proctor-events`, {
      json: { eventType: 'TAB_SWITCH', detail: 'Automated integration test' },
    });
    const first = expectOk(response, 'record proctoring event');
    equal(first.recorded, true, 'first event is recorded');
    equal(first.event.severity, 'medium', 'tab switch severity');

    response = await request(student, 'POST', `/api/student/attempts/${attempt.attemptId}/proctor-events`, {
      json: { eventType: 'TAB_SWITCH', detail: 'Duplicate within cooldown' },
    });
    const second = expectOk(response, 'repeat proctoring event');
    equal(second.recorded, false, 'repeat event inside cooldown is ignored');
    equal(second.reason, 'cooldown', 'cooldown reason');
  });

  await step('submission evaluates the attempt on the server', async () => {
    const response = await request(student, 'POST', `/api/student/attempts/${attempt.attemptId}/submit`);
    const data = expectOk(response, 'submit attempt');
    equal(data.submitted, true, 'submitted flag');
    equal(data.alreadySubmitted, false, 'first submission');
    equal(data.result, null, 'result stays hidden until released');
  });

  await step('duplicate submission does not create a second result', async () => {
    const response = await request(student, 'POST', `/api/student/attempts/${attempt.attemptId}/submit`);
    const data = expectOk(response, 'repeat submission');
    equal(data.alreadySubmitted, true, 'second submission is recognised as a duplicate');

    const attemptsResponse = await request(admin, 'GET', `/api/admin/exams/${exam.id}/attempts`);
    const attempts = expectOk(attemptsResponse, 'admin attempts');
    equal(attempts.attempts.length, 1, 'only one attempt exists');
    equal(attempts.attempts[0].obtainedMarks, 1, 'server-side evaluation marks');
    equal(attempts.attempts[0].percentage, 100, 'server-side evaluation percentage');
    equal(attempts.attempts[0].resultStatus, 'pass', 'pass outcome');
  });

  await step('student results stay hidden before release', async () => {
    const response = await request(student, 'GET', '/api/student/results');
    const data = expectOk(response, 'student results before release');
    equal(data.results.length, 0, 'no released results');
    equal(data.pendingResults, 1, 'one result awaiting release');
  });

  await step('students cannot call administrator endpoints', async () => {
    const response = await request(student, 'GET', '/api/admin/exams');
    expectError(response, 403, 'FORBIDDEN', 'student calling admin endpoint');
  });

  await step('mutations require the CSRF token', async () => {
    const response = await request(student, 'PATCH', '/api/auth/profile', {
      json: { fullName: 'CSRF Test' },
      csrf: false,
    });
    expectError(response, 403, 'CSRF_TOKEN_INVALID', 'profile update without CSRF');
  });

  await step('cross-site origins are rejected', async () => {
    const response = await request(student, 'PATCH', '/api/auth/profile', {
      json: { fullName: 'Origin Test' },
      headers: { Origin: 'https://attacker.example' },
    });
    expectError(response, 403, 'CSRF_ORIGIN_MISMATCH', 'cross-origin mutation');
  });

  await step('profile updates apply to the session', async () => {
    const response = await request(student, 'PATCH', '/api/auth/profile', {
      json: { fullName: `Integration Student ${suffix} Updated`, department: 'Quality Assurance', semester: '4' },
    });
    const data = expectOk(response, 'update profile');
    equal(data.user.department, 'Quality Assurance', 'updated department');
    equal(data.user.semester, '4', 'updated semester');
    student.user = data.user;
  });

  await step('administrator sees and reviews the proctoring event', async () => {
    let response = await request(admin, 'GET', `/api/admin/proctoring?examId=${exam.id}`);
    const data = expectOk(response, 'proctoring list');
    const event = data.items.find((item) => item.eventType === 'TAB_SWITCH');
    check(Boolean(event), 'tab switch event is listed');
    equal(event.reviewStatus, 'unreviewed', 'event starts unreviewed');
    equal(event.studentId, studentStudentId, 'event is linked to the student');

    response = await request(admin, 'PATCH', `/api/admin/proctoring/${event.id}`, {
      json: { reviewStatus: 'reviewed' },
    });
    const reviewed = expectOk(response, 'review proctoring event');
    equal(reviewed.reviewStatus, 'reviewed', 'event review status');
  });

  await step('releasing results exposes marks to the student', async () => {
    let response = await request(admin, 'PATCH', `/api/admin/exams/${exam.id}/results-publish`, {
      json: { published: true },
    });
    equal(expectOk(response, 'release results').resultsPublished, true, 'results published flag');

    response = await request(student, 'GET', '/api/student/results');
    const data = expectOk(response, 'student results after release');
    equal(data.pendingResults, 0, 'no pending results after release');
    equal(data.results.length, 1, 'one released result');
    const result = data.results[0];
    equal(result.examId, exam.id, 'result exam id');
    equal(result.obtainedMarks, 1, 'obtained marks');
    equal(result.totalMarks, 1, 'total marks');
    equal(result.percentage, 100, 'percentage');
    equal(result.status, 'pass', 'result status');
  });

  await step('password change signs out other browsing sessions', async () => {
    let response = await request(studentB, 'POST', '/api/auth/login', {
      json: { identifier: studentEmail, password: studentPassword },
    });
    const loginB = expectOk(response, 'second student login');
    studentB.csrf = loginB.csrfToken;

    response = await request(studentB, 'GET', '/api/student/dashboard');
    expectOk(response, 'second session dashboard before password change');

    response = await request(student, 'POST', '/api/auth/change-password', {
      json: { currentPassword: studentPassword, newPassword: updatedPassword, confirmPassword: updatedPassword },
    });
    expectOk(response, 'change password');

    response = await request(studentB, 'GET', '/api/student/dashboard');
    expectError(response, 401, 'AUTHENTICATION_REQUIRED', 'stale session after password change');

    response = await request(studentC, 'POST', '/api/auth/login', {
      json: { identifier: studentEmail, password: updatedPassword },
    });
    const loginC = expectOk(response, 'login with new password');
    studentC.csrf = loginC.csrfToken;

    response = await request(studentC, 'POST', '/api/auth/change-password', {
      json: { currentPassword: updatedPassword, newPassword: studentPassword, confirmPassword: studentPassword },
    });
    expectOk(response, 'restore original password');
  });

  await step('deactivation blocks access until the administrator reactivates', async () => {
    const studentId = student.user.id;
    let response = await request(admin, 'PATCH', `/api/admin/students/${studentId}`, {
      json: { isActive: false },
    });
    equal(expectOk(response, 'deactivate student').isActive, false, 'deactivated flag');

    response = await request(studentC, 'GET', '/api/student/dashboard');
    expectError(response, 401, 'AUTHENTICATION_REQUIRED', 'deactivated session');

    const blocked = new Client('blocked');
    response = await request(blocked, 'POST', '/api/auth/login', {
      json: { identifier: studentStudentId, password: studentPassword },
    });
    expectError(response, 403, 'ACCOUNT_DISABLED', 'login while deactivated');

    response = await request(admin, 'PATCH', `/api/admin/students/${studentId}`, {
      json: { isActive: true },
    });
    equal(expectOk(response, 'reactivate student').isActive, true, 'reactivated flag');

    const reactivated = new Client('reactivated');
    response = await request(reactivated, 'POST', '/api/auth/login', {
      json: { identifier: studentStudentId, password: studentPassword },
    });
    expectOk(response, 'login after reactivation');
  });

  await step('password-change attempts are rate limited', async () => {
    const limiter = new Client('rate-limit');
    let response = await request(limiter, 'POST', '/api/auth/login', {
      json: { identifier: studentEmail, password: studentPassword },
    });
    const login = expectOk(response, 'rate-limit login');
    limiter.csrf = login.csrfToken;

    let limited = 0;
    for (let index = 0; index < 15; index += 1) {
      response = await request(limiter, 'POST', '/api/auth/change-password', {
        json: { currentPassword: 'WrongPassword1', newPassword: 'AnotherPass123', confirmPassword: 'AnotherPass123' },
      });
      if (response.status === 429) limited += 1;
    }
    check(limited > 0, 'repeated password attempts eventually return HTTP 429', { limited });
  });

  console.log(`\n${passed} test groups passed.\n`);
  console.log(`Generated data: exam #${exam.id} "${exam.title}", student "${studentEmail}" (ID ${studentStudentId}).`);
  console.log('Note: the rate-limit bucket for this student is now exhausted; restart `npm run dev` to clear it.\n');
}

main().catch((error) => {
  console.error(`\n${error && error.message ? error.message : error}\n`);
  console.error(`${passed} of ${results.length + 1} test groups passed before the failure.`);
  process.exitCode = 1;
});
