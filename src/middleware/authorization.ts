import type { Role } from '../types';
import { ApiError } from '../utils/http';
import { requireAuth } from './authentication';
import type { Ctx } from '../router';

export function requireRole(ctx: Ctx, role: Role) {
  const auth = requireAuth(ctx);
  if (auth.user.role !== role) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
  }
  return auth;
}

export function requireStudent(ctx: Ctx) {
  return requireRole(ctx, 'student');
}

export function requireAdmin(ctx: Ctx) {
  return requireRole(ctx, 'admin');
}
