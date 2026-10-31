import { sessionTtlSeconds } from '../config/environment';
import { firstRow } from '../database/queries/common';
import { mapUser } from '../database/mappers';
import type { AuthUser, Role, UserRow } from '../types';
import { ApiError } from '../utils/http';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '../utils/crypto';
import { nowIso } from '../utils/time';
import type { Env } from '../config/environment';
import { Fields } from '../middleware/validation';

export interface RequestMeta {
  ip: string;
  userAgent: string;
}

export interface RegisterInput {
  fullName: string;
  studentId: string;
  email: string;
  department: string;
  semester: string;
  password: string;
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
  maxAgeSeconds: number;
  expiresAt: string;
}

async function createSession(
  env: Env,
  userId: number,
  remember: boolean,
  meta: RequestMeta,
): Promise<CreatedSession> {
  const token = randomToken(32);
  const sessionId = await sha256Hex(token);
  const csrfToken = randomToken(24);
  const maxAgeSeconds = sessionTtlSeconds(env, remember);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();

  await env.DB
    .prepare(
      `INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      sessionId,
      userId,
      csrfToken,
      createdAt,
      expiresAt,
      meta.userAgent.slice(0, 300),
      meta.ip.slice(0, 100),
    )
    .run();

  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?')
    .bind(userId, createdAt)
    .run();

  return { token, csrfToken, maxAgeSeconds, expiresAt };
}

export async function getUserById(env: Env, id: number): Promise<AuthUser | null> {
  const row = await firstRow<UserRow>(env.DB, 'SELECT * FROM users WHERE id = ?', id);
  return row ? mapUser(row) : null;
}

export async function registerStudent(
  env: Env,
  input: RegisterInput,
  meta: RequestMeta,
): Promise<{ user: AuthUser; session: CreatedSession }> {
  const existingEmail = await firstRow<{ id: number }>(
    env.DB,
    'SELECT id FROM users WHERE email = ?',
    input.email,
  );
  const existingStudentId = await firstRow<{ id: number }>(
    env.DB,
    'SELECT id FROM users WHERE student_id = ? COLLATE NOCASE',
    input.studentId,
  );

  const fields: Record<string, string> = {};
  if (existingEmail) fields.email = 'An account with this email address already exists.';
  if (existingStudentId) fields.studentId = 'This Student ID is already registered.';
  if (Object.keys(fields).length > 0) {
    throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account with these details already exists.', fields);
  }

  const passwordHash = await hashPassword(input.password);
  const createdAt = nowIso();

  let userId: number;
  try {
    const result = await env.DB
      .prepare(
        `INSERT INTO users (full_name, student_id, email, department, semester, password_hash, role, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'student', 1, ?)`,
      )
      .bind(
        input.fullName,
        input.studentId,
        input.email,
        input.department,
        input.semester,
        passwordHash,
        createdAt,
      )
      .run();
    userId = Number(result.meta.last_row_id);
  } catch (error) {
    console.error('Registration insert failed', error);
    throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account with these details already exists.');
  }

  const user = await getUserById(env, userId);
  if (!user) throw new ApiError(500, 'INTERNAL_ERROR', 'Could not create the account.');
  const session = await createSession(env, userId, false, meta);
  return { user, session };
}

export async function loginUser(
  env: Env,
  identifier: string,
  password: string,
  expectedRole: Role,
  remember: boolean,
  meta: RequestMeta,
): Promise<{ user: AuthUser; session: CreatedSession }> {
  const row = await firstRow<UserRow>(
    env.DB,
    'SELECT * FROM users WHERE email = ? OR student_id = ? COLLATE NOCASE LIMIT 1',
    identifier,
    identifier,
  );

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials. Check your details and try again.');
  }

  if (row.role !== expectedRole) {
    throw new ApiError(
      403,
      'WRONG_LOGIN_PORTAL',
      expectedRole === 'admin'
        ? 'This account is not an administrator account.'
        : 'Administrator accounts must use the administrator sign-in page.',
    );
  }

  if (!row.is_active) {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated. Contact the examination administrator.');
  }

  const session = await createSession(env, row.id, remember, meta);
  return { user: mapUser(row), session };
}

export async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export async function changePassword(
  env: Env,
  userId: number,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const row = await firstRow<UserRow>(env.DB, 'SELECT * FROM users WHERE id = ?', userId);
  if (!row) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in again.');
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    throw new ApiError(422, 'INVALID_PASSWORD', 'Your current password is incorrect.', {
      currentPassword: 'Your current password is incorrect.',
    });
  }
  if (currentPassword === newPassword) {
    throw new ApiError(422, 'PASSWORD_UNCHANGED', 'Choose a password different from your current password.', {
      newPassword: 'Choose a password different from your current password.',
    });
  }
  const hash = await hashPassword(newPassword);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, userId).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?')
    .bind(userId, currentSessionId)
    .run();
}

export async function updateProfile(
  env: Env,
  userId: number,
  input: Record<string, unknown>,
): Promise<AuthUser> {
  const row = await firstRow<UserRow>(env.DB, 'SELECT * FROM users WHERE id = ?', userId);
  if (!row) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in again.');

  const f = new Fields();
  const fullName = input.fullName === undefined
    ? row.full_name
    : f.text('fullName', input.fullName, 'Full name', 2, 120);
  const department = input.department === undefined
    ? row.department
    : f.text('department', input.department, 'Department', 2, 100);
  const semester = input.semester === undefined
    ? row.semester
    : f.oneOf('semester', input.semester, ['1', '2', '3', '4', '5', '6', '7', '8'] as const, 'Semester', '1');
  f.done();

  await env.DB
    .prepare('UPDATE users SET full_name = ?, department = ?, semester = ? WHERE id = ?')
    .bind(fullName, department, semester, userId)
    .run();

  const updated = await getUserById(env, userId);
  if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
  return updated;
}
