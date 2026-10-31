export function queryText(url: URL, name: string, max = 200): string | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

export function queryInt(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function queryEnum<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const raw = url.searchParams.get(name);
  if (!raw) return undefined;
  return allowed.includes(raw as T) ? (raw as T) : undefined;
}
