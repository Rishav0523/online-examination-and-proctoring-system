import type { Env } from './config/environment';
import type { AuthContext } from './types';
import { loadAuth, requireAuth } from './middleware/authentication';
import { assertCsrfToken, assertSameOrigin } from './middleware/csrf';
import { ApiError, clientIp, errorResponse } from './utils/http';
import { authRoutes } from './modules/auth/auth.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { studentRoutes } from './modules/students/student.routes';
import { examinationRoutes } from './modules/examinations/examination.routes';
import { questionRoutes } from './modules/questions/question.routes';
import { resultRoutes } from './modules/results/result.routes';
import { proctoringRoutes } from './modules/proctoring/proctoring.routes';

export type RouteMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type RouteAuth = 'public' | 'student' | 'admin' | 'authenticated';

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  ip: string;
  userAgent: string;
  auth?: AuthContext;
}

export type Handler = (ctx: Ctx) => Promise<Response>;

export interface Route {
  method: RouteMethod;
  path: string;
  auth?: RouteAuth;
  /** Set to false only for unauthenticated login/registration endpoints. */
  csrf?: boolean;
  handler: Handler;
}

const routes: Route[] = [
  ...authRoutes,
  ...adminRoutes,
  ...studentRoutes,
  ...examinationRoutes,
  ...questionRoutes,
  ...resultRoutes,
  ...proctoringRoutes,
];

const MUTATING = new Set<RouteMethod>(['POST', 'PATCH', 'PUT', 'DELETE']);

function matchPath(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const segment = segments[index];
    if (part.startsWith(':')) {
      if (!segment) return null;
      try {
        params[part.slice(1)] = decodeURIComponent(segment);
      } catch {
        return null;
      }
    } else if (part !== segment) {
      return null;
    }
  }
  return params;
}

export async function dispatchApi(
  request: Request,
  env: Env,
  url: URL,
  path: string,
): Promise<Response> {
  const ctx: Ctx = {
    req: request,
    env,
    url,
    params: {},
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent') ?? '',
  };

  try {
    await loadAuth(ctx);
    const segments = path.split('/').filter(Boolean);

    for (const route of routes) {
      if (route.method !== request.method) continue;
      const params = matchPath(route.path, segments);
      if (!params) continue;
      ctx.params = params;

      const mode = route.auth ?? 'public';
      if (mode !== 'public') {
        const auth = requireAuth(ctx);
        if (mode === 'student' && auth.user.role !== 'student') {
          throw new ApiError(403, 'FORBIDDEN', 'Student access is required for this resource.');
        }
        if (mode === 'admin' && auth.user.role !== 'admin') {
          throw new ApiError(403, 'FORBIDDEN', 'Administrator access is required for this resource.');
        }
      }

      if (MUTATING.has(route.method)) {
        assertSameOrigin(ctx);
        if (ctx.auth && route.csrf !== false) assertCsrfToken(ctx);
      }

      return await route.handler(ctx);
    }

    throw new ApiError(404, 'NOT_FOUND', 'API route not found.');
  } catch (error) {
    return errorResponse(error);
  }
}
