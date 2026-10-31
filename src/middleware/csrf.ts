import { ApiError } from '../utils/http';
import type { Ctx } from '../router';

/** Reject cross-site state-changing requests. Browsers send Origin on these. */
export function assertSameOrigin(ctx: Ctx): void {
  const origin = ctx.req.headers.get('origin');
  if (origin && origin !== ctx.url.origin) {
    throw new ApiError(403, 'CSRF_ORIGIN_MISMATCH', 'Cross-site request blocked.');
  }
}

/** Double-check a session-bound token supplied through a custom header. */
export function assertCsrfToken(ctx: Ctx): void {
  if (!ctx.auth) return;
  const token = ctx.req.headers.get('x-csrf-token') ?? '';
  if (!token || token !== ctx.auth.csrfToken) {
    throw new ApiError(403, 'CSRF_TOKEN_INVALID', 'Your security token has expired. Refresh the page and try again.');
  }
}
