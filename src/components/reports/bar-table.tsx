import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, cx } from "@/components/ui";

export interface BarRow {
  key: string;
  label: ReactNode;
  href?: string;
  /** The first value drives the bar. */
  values: number[];
  /** Highlight the second value (e.g. "overdue") when it is above zero. */
  alert?: boolean;
}

/**
 * An accessible table with a simple proportional bar (no chart library). The bar is decorative:
 * every number is also written out as text in its own column.
 */
export function BarTable({ caption, nameHeader, valueHeaders, rows, empty, emptyHint, barTone = "brand" }: {
  caption: string; nameHeader: string; valueHeaders: string[]; rows: BarRow[]; empty: string; emptyHint?: string;
  barTone?: "brand" | "danger" | "warn" | "info";
}) {
  if (!rows.length) return <EmptyState title={empty}>{emptyHint}</EmptyState>;
  const max = Math.max(1, ...rows.map((r) => r.values[0] ?? 0));
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="text-[12px] text-ink-3 border-b border-line">
        <tr>
          <th scope="col" className="text-start font-medium py-2 ps-5 pe-3">{nameHeader}</th>
          {valueHeaders.map((h) => <th key={h} scope="col" className="text-end font-medium px-3 whitespace-nowrap">{h}</th>)}
          <th scope="col" className="w-[35%] pe-5 hidden sm:table-cell"><span className="sr-only">המחשה</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row" className="text-start font-normal py-2.5 ps-5 pe-3">
              {r.href ? <Link href={r.href} className="text-ink hover:text-brand hover:underline">{r.label}</Link> : r.label}
            </th>
            {r.values.map((v, i) => (
              <td key={i} className={cx("px-3 text-end tabular-nums", i === 1 && r.alert && v > 0 ? "text-danger font-semibold" : i === 0 ? "font-medium" : "text-ink-2")}>
                {v.toLocaleString("he-IL")}
              </td>
            ))}
            <td className="pe-5 hidden sm:table-cell" aria-hidden>
              <div className="h-2 rounded-full bg-muted-soft overflow-hidden">
                <div
                  className={cx("h-full rounded-full", barTone === "brand" && "bg-brand", barTone === "danger" && "bg-danger", barTone === "warn" && "bg-warn", barTone === "info" && "bg-info")}
                  style={{ width: `${Math.max(2, Math.round(((r.values[0] ?? 0) / max) * 100))}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
