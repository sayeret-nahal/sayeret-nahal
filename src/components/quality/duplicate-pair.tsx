import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge, Card, DemoTag, cx } from "@/components/ui";
import { displayPhone } from "@/lib/phone";
import { formatDate } from "@/lib/dates";
import { SOURCE_LABELS } from "@/lib/labels";
import { DuplicateActions } from "./duplicate-actions";

export interface PairContact {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  cohort: string;
  region: string;
  city: string | null;
  created_at: string;
  source: string;
  is_demo: boolean;
  archived: boolean;
  interactions: number;
}

const NAME_ONLY = "שם דומה";

/** One suggested duplicate pair, side by side, with the reasons and the actions. */
export function DuplicatePair({ a, b, reasons, score, canMerge }: { a: PairContact; b: PairContact; reasons: string; score: number; canMerge: boolean }) {
  const list = reasons.split(",").map((r) => r.trim()).filter(Boolean);
  const nameOnly = list.length === 1 && list[0] === NAME_ONLY;
  const richer = a.interactions === b.interactions ? null : a.interactions > b.interactions ? a.id : b.id;
  const rows: { label: string; get: (c: PairContact) => string; ltr?: boolean }[] = [
    { label: "טלפון", get: (c) => displayPhone(c.phone), ltr: true },
    { label: "דוא״ל", get: (c) => c.email ?? "", ltr: true },
    { label: "מחזור", get: (c) => c.cohort },
    { label: "אזור", get: (c) => c.region },
    { label: "יישוב", get: (c) => c.city ?? "" },
    { label: "נוצרה", get: (c) => `${formatDate(c.created_at)} · ${SOURCE_LABELS[c.source] ?? c.source}` },
    { label: "תיעודים", get: (c) => (c.interactions ? `${c.interactions.toLocaleString("he-IL")} שיחות, פגישות והודעות` : "אין") },
  ];

  return (
    <Card className={cx(nameOnly && "border-warn/40")}>
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
        {nameOnly ? (
          <Badge tone="warn"><AlertTriangle className="size-3.5" aria-hidden />דמיון בשם בלבד — נדרשת בדיקה אנושית</Badge>
        ) : (
          list.map((r) => <Badge key={r} tone={r === NAME_ONLY ? "neutral" : "info"}>{r}</Badge>)
        )}
        {list.includes(NAME_ONLY) && <span className="text-[12px] text-ink-3">דמיון שמות {Math.round(score * 100)}%</span>}
      </div>
      {nameOnly && (
        <p className="px-5 pb-3 text-[13px] text-ink-2">
          ייתכן שאלה שני אנשים שונים עם שם דומה. לפני איחוד, בדקו מחזור, יישוב ופרטי קשר — ואם צריך, התקשרו לוודא.
        </p>
      )}
      <div className="grid md:grid-cols-2 border-t border-line">
        {[a, b].map((c, i) => {
          const other = i === 0 ? b : a;
          return (
            <section key={c.id} aria-label={`רשומה ${i === 0 ? "ראשונה" : "שנייה"}: ${c.full_name}`}
              className={cx("px-5 py-4", i === 1 && "border-t md:border-t-0 md:border-s border-line")}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-[11px] text-ink-3">
                  <span className="hidden md:inline">{i === 0 ? "ימין" : "שמאל"}</span>
                  <span className="md:hidden">{i === 0 ? "עליונה" : "תחתונה"}</span>
                </span>
                <Link href={`/contacts/${c.id}`} className="font-semibold text-ink hover:text-brand hover:underline">{c.full_name}</Link>
                {c.is_demo && <DemoTag />}
                {c.archived && <Badge>בארכיון</Badge>}
                {richer === c.id && <Badge tone="ok">יותר היסטוריה</Badge>}
              </div>
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                {rows.map((r) => {
                  const v = r.get(c);
                  const ov = r.get(other);
                  const differs = r.label !== "נוצרה" && r.label !== "תיעודים" && v !== "" && ov !== "" && v !== ov;
                  return (
                    <div key={r.label} className="contents">
                      <dt className="text-ink-3 text-[13px]">{r.label}</dt>
                      <dd className={cx("min-w-0 break-words", !v && "text-ink-3")}>
                        {v ? (
                          <span className={cx(differs && "bg-warn-soft rounded px-1")}>
                            {r.ltr ? <bdi dir="ltr">{v}</bdi> : v}
                            {differs && <span className="sr-only"> (שונה מהרשומה השנייה)</span>}
                          </span>
                        ) : "—"}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          );
        })}
      </div>
      <div className="border-t border-line px-5 py-3">
        <DuplicateActions
          a={{ id: a.id, name: a.full_name, created: formatDate(a.created_at) }}
          b={{ id: b.id, name: b.full_name, created: formatDate(b.created_at) }}
          canMerge={canMerge}
          nameOnly={nameOnly}
        />
      </div>
    </Card>
  );
}
