export type SqlParam = string | number | null;

export async function allRows<T>(
  db: D1Database,
  sql: string,
  ...params: SqlParam[]
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return (result.results ?? []) as T[];
}

export async function firstRow<T>(
  db: D1Database,
  sql: string,
  ...params: SqlParam[]
): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) as T | null;
}

export async function execute(
  db: D1Database,
  sql: string,
  ...params: SqlParam[]
): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

export async function scalar(
  db: D1Database,
  sql: string,
  ...params: SqlParam[]
): Promise<number> {
  const row = await firstRow<{ value: number | string | null }>(db, sql, ...params);
  return Number(row?.value ?? 0);
}
