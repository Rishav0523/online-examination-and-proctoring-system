export function nowIso(): string {
  return new Date().toISOString();
}

export function isoNowMinusSeconds(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

export function isoAddMinutes(minutes: number, fromMs = Date.now()): string {
  return new Date(fromMs + minutes * 60_000).toISOString();
}

export function earlierIso(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

export function isAfter(aIso: string, bIso: string): boolean {
  return Date.parse(aIso) > Date.parse(bIso);
}

export function isPast(iso: string): boolean {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && parsed < Date.now();
}

export function secondsUntil(iso: string, fromMs = Date.now()): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor((parsed - fromMs) / 1000));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
