import { ApiError } from '../utils/http';

interface Bucket {
  count: number;
  resetAt: number;
}

// Per-isolate limiter. Cloudflare may run multiple isolates, so this is a
// practical deterrent rather than a global quota.
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    return;
  }
  existing.count += 1;
  if (existing.count > limit) {
    const seconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    throw new ApiError(429, 'RATE_LIMITED', `Too many attempts. Please try again in ${seconds} seconds.`);
  }
}
