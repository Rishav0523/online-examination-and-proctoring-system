export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV?: string;
  BASE_PATH?: string;
  SESSION_TTL_HOURS?: string;
  SESSION_TTL_REMEMBER_HOURS?: string;
}

export const SESSION_COOKIE = 'oeps_session';
export const PASSWORD_ITERATIONS = 100_000;
export const MAX_PASSWORD_ITERATIONS = 500_000;

/** In-flight network grace period around the authoritative deadline. */
export const SUBMISSION_GRACE_SECONDS = 8;

export function basePath(env: Env): string {
  const raw = (env.BASE_PATH ?? '').trim();
  if (!raw || raw === '/') return '';
  return raw.replace(/\/+$/, '');
}

export function isProduction(env: Env): boolean {
  return (env.APP_ENV ?? '').toLowerCase() === 'production';
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function sessionTtlSeconds(env: Env, remember: boolean): number {
  const hours = remember
    ? positiveInt(env.SESSION_TTL_REMEMBER_HOURS, 720)
    : positiveInt(env.SESSION_TTL_HOURS, 12);
  return hours * 3600;
}
