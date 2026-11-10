// The API returns at most 1,000 rows per request, so totals are computed by paging through
// the rows (ordered by a stable key). `max` caps the work; `truncated` tells the page to say so.

const STEP = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = 50_000,
): Promise<{ rows: T[]; error: boolean; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += STEP) {
    const { data, error } = await page(from, from + STEP - 1);
    if (error) return { rows, error: true, truncated: false };
    rows.push(...(data ?? []));
    if (!data || data.length < STEP) return { rows, error: false, truncated: false };
  }
  return { rows, error: false, truncated: true };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
