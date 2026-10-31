import { SESSION_COOKIE } from '../config/environment';
import { mapUser } from '../database/mappers';
import type { AuthContext, UserRow } from '../types';
import { getCookie, ApiError } from '../utils/http';
import { sha256Hex } from '../utils/crypto';
import { nowIso } from '../utils/time';
import type { Ctx } from '../router';

interface SessionJoinRow extends UserRow {
  session_id: string;
  csrf_token: string;
  session_expires_at: string;
}

export async function loadAuth(ctx: Ctx): Promise<void> {
  const token = getCookie(ctx.req, SESSION_COOKIE);
  if (!token) return;
  const sessionId = await sha256Hex(token);
  const row = await ctx.env.DB
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at AS session_expires_at,
              u.id, u.full_name, u.student_id, u.email, u.department, u.semester,
              u.password_hash, u.role, u.is_active, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<SessionJoinRow>();

  if (!row) return;

  if (row.session_expires_at <= nowIso()) {
    await ctx.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    return;
  }

  if (!row.is_active) {
    await ctx.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    return;
  }

  ctx.auth = {
    user: mapUser(row),
    sessionId,
    csrfToken: row.csrf_token,
    expiresAt: row.session_expires_at,
  } satisfies AuthContext;
}

export function requireAuth(ctx: Ctx): AuthContext {
  if (!ctx.auth) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');
  return ctx.auth;
}
