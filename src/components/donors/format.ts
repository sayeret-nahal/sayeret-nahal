// Formatting helpers for the donors module (pure; safe on server and client).

/** 12500 → "₪12,500" (agorot shown only when present). */
export function ils(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `₪${v.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

/** Amount in its own currency: ILS → "₪1,200", others → "1,200 USD". */
export function money(n: number | string, currency: string | null | undefined): string {
  if (!currency || currency === "ILS") return ils(n);
  return `${Number(n).toLocaleString("he-IL", { maximumFractionDigits: 2 })} ${currency}`;
}

export const METHODS = ["העברה", "אשראי", "מזומן", "צ׳ק", "הוראת קבע", "אחר"] as const;
