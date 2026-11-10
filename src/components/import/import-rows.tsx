"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { Badge, Button, cx, type Tone } from "@/components/ui";
import { displayPhone } from "@/lib/phone";
import { PREVIEW_ROWS, STATUS_LABELS, toCsv, type ImportMode, type PlanRow, type RowStatus } from "@/lib/import";

const TONES: Record<RowStatus, Tone> = {
  new: "ok", update: "info", error: "danger", duplicate: "warn", exists: "neutral", unmatched: "warn",
};

export function statusLabel(mode: ImportMode, r: PlanRow, createDonors?: boolean): string {
  if (mode === "donations" && r.status === "unmatched") {
    return createDonors ? "ייווצר איש קשר חדש" : "לא נמצא איש קשר — תדולג";
  }
  return STATUS_LABELS[mode][r.status];
}

export function StatusBadge({ mode, row, createDonors }: { mode: ImportMode; row: PlanRow; createDonors?: boolean }) {
  const tone = mode === "donations" && row.status === "unmatched" && createDonors ? "info" : TONES[row.status];
  return <Badge tone={tone}>{statusLabel(mode, row, createDonors)}</Badge>;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : n.toLocaleString("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });

function contactLine(r: PlanRow): string {
  return [displayPhone(r.phone), r.email].filter(Boolean).join(" · ");
}

/** Download rows (with status and reason) as a CSV that opens in Excel. */
export function downloadRows(rows: PlanRow[], mode: ImportMode, fileName: string, createDonors?: boolean) {
  const head = mode === "donations"
    ? ["שורה בקובץ", "שם", "טלפון", "דוא״ל", "סכום", "תאריך", "אסמכתא", "מצב", "סיבה", "אזהרות"]
    : ["שורה בקובץ", "שם", "טלפון", "דוא״ל", "מצב", "סיבה", "אזהרות"];
  const body = rows.map((r) => mode === "donations"
    ? [r.row, r.name, displayPhone(r.phone), r.email ?? "", r.amount ?? "", r.date ?? "", r.ref ?? "", statusLabel(mode, r, createDonors), r.reason, r.warnings.join("; ")]
    : [r.row, r.name, displayPhone(r.phone), r.email ?? "", statusLabel(mode, r, createDonors), r.reason, r.warnings.join("; ")]);
  const blob = new Blob([toCsv([head, ...body])], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DownloadButton({ rows, mode, fileName, label, createDonors }: { rows: PlanRow[]; mode: ImportMode; fileName: string; label: string; createDonors?: boolean }) {
  if (!rows.length) return null;
  return (
    <Button size="sm" onClick={() => downloadRows(rows, mode, fileName, createDonors)}>
      <Download className="size-4" aria-hidden /> {label}
    </Button>
  );
}

export type RowFilter = { key: string; label: string; test: (r: PlanRow) => boolean };

/** Filterable table of rows (first 200 of the current filter), with a list layout on small screens. */
export function RowsTable({ rows, mode, filters, createDonors, caption }: {
  rows: PlanRow[]; mode: ImportMode; filters: RowFilter[]; createDonors?: boolean; caption: string;
}) {
  const [active, setActive] = useState(filters[0]?.key ?? "all");
  const filter = filters.find((f) => f.key === active) ?? filters[0];
  const shown = useMemo(() => rows.filter(filter.test), [rows, filter]);
  const visible = shown.slice(0, PREVIEW_ROWS);
  const donations = mode === "donations";

  return (
    <div>
      {filters.length > 1 && (
        <div role="group" aria-label="סינון השורות" className="flex flex-wrap gap-1.5 px-5 pb-3">
          {filters.map((f) => {
            const n = rows.filter(f.test).length;
            const on = f.key === active;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={on}
                onClick={() => setActive(f.key)}
                className={cx(
                  "h-9 rounded-full px-3 text-[13px] border transition-colors",
                  on ? "bg-brand text-white border-brand" : "bg-surface text-ink-2 border-line-strong hover:bg-canvas",
                )}
              >
                {f.label} <span className="tabular-nums opacity-80">({n.toLocaleString("he-IL")})</span>
              </button>
            );
          })}
        </div>
      )}

      {!visible.length ? (
        <p className="px-5 pb-5 text-sm text-ink-3">אין שורות להצגה בסינון הזה.</p>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto border-t border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="text-[12px] text-ink-3 border-b border-line">
                <tr>
                  <th scope="col" className="text-start font-medium py-2.5 ps-5 pe-3 w-16">שורה</th>
                  <th scope="col" className="text-start font-medium px-3">שם</th>
                  <th scope="col" className="text-start font-medium px-3">פרטי קשר</th>
                  {donations && <th scope="col" className="text-start font-medium px-3">סכום ותאריך</th>}
                  <th scope="col" className="text-start font-medium px-3">מצב</th>
                  <th scope="col" className="text-start font-medium px-3 pe-5">פירוט</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((r) => (
                  <tr key={r.row} className="align-top">
                    <td className="py-2.5 ps-5 pe-3 text-ink-3 tabular-nums">{r.row}</td>
                    <td className="py-2.5 px-3 font-medium">{r.name || <span className="text-ink-3 font-normal">ללא שם</span>}</td>
                    <td className="py-2.5 px-3 text-ink-2"><bdi dir="ltr">{contactLine(r)}</bdi></td>
                    {donations && <td className="py-2.5 px-3 text-ink-2 whitespace-nowrap tabular-nums">{money(r.amount)}{r.date ? <span className="block text-[12px] text-ink-3">{r.date.split("-").reverse().join(".")}</span> : null}</td>}
                    <td className="py-2.5 px-3"><StatusBadge mode={mode} row={r} createDonors={createDonors} /></td>
                    <td className="py-2.5 px-3 pe-5 text-ink-2 max-w-md">
                      <RowDetails r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden divide-y divide-line border-t border-line" aria-label={caption}>
            {visible.map((r) => (
              <li key={r.row} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{r.name || <span className="text-ink-3 font-normal">ללא שם</span>}</div>
                    <div className="text-[12px] text-ink-3">שורה {r.row}{contactLine(r) ? <> · <bdi dir="ltr">{contactLine(r)}</bdi></> : null}</div>
                    {donations && r.amount ? <div className="text-[12px] text-ink-2 tabular-nums">{money(r.amount)}{r.date ? ` · ${r.date.split("-").reverse().join(".")}` : ""}</div> : null}
                  </div>
                  <StatusBadge mode={mode} row={r} createDonors={createDonors} />
                </div>
                <div className="mt-1.5 text-[13px] text-ink-2"><RowDetails r={r} /></div>
              </li>
            ))}
          </ul>
          {shown.length > visible.length && (
            <p className="px-5 py-3 text-[12px] text-ink-3 border-t border-line">
              מוצגות {visible.length.toLocaleString("he-IL")} השורות הראשונות מתוך {shown.length.toLocaleString("he-IL")}. הרשימה המלאה זמינה להורדה.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function RowDetails({ r }: { r: PlanRow }) {
  return (
    <>
      {r.reason && <p>{r.reason}</p>}
      {r.warnings.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {r.warnings.map((w, i) => (
            <li key={i} className="text-[12px] text-warn"><AlertTriangle className="inline size-3.5 me-1 align-[-2px]" aria-hidden /><span className="sr-only">אזהרה: </span>{w}</li>
          ))}
        </ul>
      )}
    </>
  );
}
