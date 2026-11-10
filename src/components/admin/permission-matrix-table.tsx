import { Check, Minus } from "lucide-react";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/labels";
import { CAPABILITIES, ROLE_ORDER, type Cell } from "./permission-matrix";

function CellView({ cell }: { cell: Cell }) {
  if (cell.level === "yes") {
    return (
      <span className="inline-flex items-center gap-1 text-ok">
        <Check className="size-4" aria-hidden /><span className="sr-only">כן</span>
      </span>
    );
  }
  if (cell.level === "no") {
    return (
      <span className="inline-flex items-center text-ink-3">
        <Minus className="size-4" aria-hidden /><span className="sr-only">לא</span>
      </span>
    );
  }
  return <span className="text-[12px] leading-4 text-warn">חלקי: {cell.note}</span>;
}

export function PermissionMatrixTable() {
  return (
    <>
      {/* desktop / tablet: roles × capabilities */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <caption className="sr-only">מטריצת הרשאות: מה כל תפקיד יכול לעשות</caption>
          <thead className="text-[12px] text-ink-3 border-b border-line">
            <tr>
              <th scope="col" className="text-start font-medium py-2.5 ps-5 pe-3 w-[26%]">יכולת</th>
              {ROLE_ORDER.map((r) => (
                <th key={r} scope="col" className="text-start font-medium px-2 align-bottom" title={ROLE_DESCRIPTIONS[r]}>{ROLE_LABELS[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {CAPABILITIES.map((c) => (
              <tr key={c.key}>
                <th scope="row" className="text-start font-normal text-ink py-2.5 ps-5 pe-3">{c.label}</th>
                {ROLE_ORDER.map((r) => (
                  <td key={r} className="px-2 py-2.5 align-top"><CellView cell={c.cells[r]} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile: one expandable block per role */}
      <ul className="md:hidden divide-y divide-line">
        {ROLE_ORDER.map((r) => (
          <li key={r}>
            <details className="group px-4 py-3">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-2 min-h-9">
                <span className="font-medium">{ROLE_LABELS[r]}</span>
                <span className="text-[12px] text-brand group-open:hidden">הצגה</span>
                <span className="text-[12px] text-brand hidden group-open:inline">הסתרה</span>
              </summary>
              <p className="text-[13px] text-ink-2 mt-1">{ROLE_DESCRIPTIONS[r]}</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {CAPABILITIES.map((c) => (
                  <li key={c.key} className="flex items-start justify-between gap-3">
                    <span className="text-ink-2">{c.label}</span>
                    <span className="shrink-0 max-w-[50%] text-end"><CellView cell={c.cells[r]} /></span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      <p className="px-5 py-3 text-[12px] text-ink-3 border-t border-line">
        ההרשאות נאכפות במסד הנתונים עצמו, לא רק במסכים. &quot;בתחום שלו/ה&quot; = המחזורים או האזורים שהוקצו למשתמש/ת.
      </p>
    </>
  );
}
