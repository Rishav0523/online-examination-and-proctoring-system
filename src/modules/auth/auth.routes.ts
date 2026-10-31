import { isProduction } from '../../config/environment';
import { SESSION_COOKIE } from '../../config/environment';
import { Fields } from '../../middleware/validation';
import { requireAuth } from '../../middleware/authentication';
import { rateLimit } from '../../middleware/rate-limit';
import {
  changePassword,
  deleteSession,
  loginUser,
  registerStudent,
  updateProfile,
} from '../../services/authentication.service';
import type { Env } from '../../config/environment';
import { clearCookie, ok, readJsonBody, serializeCookie } from '../../utils/http';
import type { CreatedSession } from '../../services/authentication.service';
import type { Ctx, Route } from '../../router';

function cookieFor(env: Env, session: CreatedSession): string {
  return serializeCookie(SESSION_COOKIE, session.token, {
    maxAge: session.maxAgeSeconds,
    httpOnly: true,
    secure: isProduction(env),
    sameSite: 'Lax',
    path: '/',
  });
}

const SEMESTERS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

async function handleRegister(ctx: Ctx): Promise<Response> {
  rateLimit(`register:${ctx.ip}`, 10, 60 * 60 * 1000);
  const body = await readJsonBody(ctx.req);
  const f = new Fields();
  const fullName = f.text('fullName', body.fullName, 'Full name', 2, 120);
  const studentId = f.studentId('studentId', body.studentId);
  const email = f.email('email', body.email);
  const department = f.text('department', body.department, 'Department', 2, 100);
  const semester = f.oneOf('semester', body.semester, SEMESTERS, 'Semester', '1');
  const password = f.password('password', body.password);
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
  f.matches('confirmPassword', password, confirmPassword, 'Passwords do not match.');
  f.done();

  const { user, session } = await registerStudent(
    ctx.env,
    { fullName, studentId, email, department, semester, password },
    { ip: ctx.ip, userAgent: ctx.userAgent },
  );

  return ok(
    { user, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
    201,
    { 'Set-Cookie': cookieFor(ctx.env, session) },
  );
}

async function handleLogin(ctx: Ctx, expectedRole: 'student' | 'admin'): Promise<Response> {
  rateLimit(`login:${expectedRole}:${ctx.ip}`, 20, 10 * 60 * 1000);
  const body = await readJsonBody(ctx.req);
  const f = new Fields();
  const identifier = f.text('identifier', body.identifier, 'Email or Student ID', 3, 254);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) f.check('password', false, 'Password is required.');
  else if (password.length > 128) f.check('password', false, 'Password is too long.');
  const remember = body.remember === undefined ? false : f.boolean('remember', body.remember, 'Remember me');
  f.done();

  const { user, session } = await loginUser(
    ctx.env,
    identifier,
    password,
    expectedRole,
    remember,
    { ip: ctx.ip, userAgent: ctx.userAgent },
  );

  return ok(
    { user, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
    200,
    { 'Set-Cookie': cookieFor(ctx.env, session) },
  );
}

async function handleSession(ctx: Ctx): Promise<Response> {
  if (!ctx.auth) return ok({ user: null, csrfToken: null });
  return ok({
    user: ctx.auth.user,
    csrfToken: ctx.auth.csrfToken,
    expiresAt: ctx.auth.expiresAt,
  });
}

async function handleLogout(ctx: Ctx): Promise<Response> {
  if (ctx.auth) await deleteSession(ctx.env, ctx.auth.sessionId);
  return ok(
    { loggedOut: true },
    200,
    { 'Set-Cookie': clearCookie(SESSION_COOKIE, isProduction(ctx.env)) },
  );
}

async function handleChangePassword(ctx: Ctx): Promise<Response> {
  const auth = requireAuth(ctx);
  rateLimit(`password:${auth.user.id}`, 10, 60 * 60 * 1000);
  const body = await readJsonBody(ctx.req);
  const f = new Fields();
  const currentPassword = f.password('currentPassword', body.currentPassword, 'Current password');
  const newPassword = f.password('newPassword', body.newPassword, 'New password');
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
  f.matches('confirmPassword', newPassword, confirmPassword, 'New passwords do not match.');
  f.done();

  await changePassword(ctx.env, auth.user.id, auth.sessionId, currentPassword, newPassword);
  return ok({ changed: true });
}

async function handleProfileUpdate(ctx: Ctx): Promise<Response> {
  const auth = requireAuth(ctx);
  const body = await readJsonBody(ctx.req);
  const user = await updateProfile(ctx.env, auth.user.id, body);
  return ok({ user });
}

export const authRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    handler: async () => ok({ status: 'ok', time: new Date().toISOString() }),
  },
  {
    method: 'GET',
    path: '/api/auth/session',
    handler: handleSession,
  },
  {
    method: 'POST',
    path: '/api/auth/register',
    csrf: false,
    handler: handleRegister,
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    csrf: false,
    handler: (ctx) => handleLogin(ctx, 'student'),
  },
  {
    method: 'POST',
    path: '/api/auth/admin/login',
    csrf: false,
    handler: (ctx) => handleLogin(ctx, 'admin'),
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    handler: handleLogout,
  },
  {
    method: 'POST',
    path: '/api/auth/change-password',
    auth: 'authenticated',
    handler: handleChangePassword,
  },
  {
    method: 'PATCH',
    path: '/api/auth/profile',
    auth: 'authenticated',
    handler: handleProfileUpdate,
  },
];
