"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Field, Input, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { previewAudience, saveDraft } from "@/app/(app)/broadcasts/actions";

type Template = { id: number; name: string; channel: string; body: string; variables: string[]; category: string };
type L = { id: number; label: string };
type T = { code: string; label: string };

const VAR_LABEL: Record<string, string> = { first_name: "שם פרטי", full_name: "שם מלא", cohort: "מחזור", city: "יישוב", custom: "טקסט קבוע" };

export function ComposeForm({ templates, types, cohorts, regions }: { templates: Template[]; types: T[]; cohorts: L[]; regions: L[] }) {
  const [tid, setTid] = useState<number>(templates[0]?.id ?? 0);
  const [custom, setCustom] = useState<string[]>(["", "", "", "", ""]);
  const [count, setCount] = useState<{ total: number; consented: number } | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLDivElement>(null);
  const t = templates.find((x) => x.id === tid);

  function recount() {
    const form = formRef.current?.closest("form");
    if (!form) return;
    const fd = new FormData(form);
    start(async () => {
      const r = await previewAudience(fd);
      setCount("error" in r ? null : r);
    });
  }
  useEffect(() => { recount(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = t ? t.body.replace(/\{\{\s*(\d)\s*\}\}/g, (_, i) => {
    const v = t.variables[Number(i) - 1];
    return v === "custom" ? custom[Number(i) - 1] || "…" : `[${VAR_LABEL[v] ?? "?"}]`;
  }) : "";

  return (
    <ActionForm action={saveDraft} className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
      {(st) => (
        <>
          <div ref={formRef} className="flex flex-col gap-5" onChange={recount}>
            <Field label="כותרת פנימית" htmlFor="b-title" required error={st.fieldErrors?.title} hint="לא נשלחת — רק לזיהוי ברשימה">
              <Input id="b-title" name="title" required maxLength={120} />
            </Field>
            <Field label="תבנית" htmlFor="b-template" required error={st.fieldErrors?.template_id}>
              <Select id="b-template" name="template_id" value={tid} onChange={(e) => setTid(Number(e.target.value))}>
                {templates.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.channel === "sms" ? "SMS" : "וואטסאפ"}</option>)}
              </Select>
            </Field>
            {t?.variables.map((v, i) => v === "custom" && (
              <Field key={i} label={`ערך עבור {{${i + 1}}}`} htmlFor={`b-c${i}`}>
                <Input id={`b-c${i}`} name={`custom_${i + 1}`} maxLength={200} value={custom[i]} onChange={(e) => setCustom(custom.map((c, j) => (j === i ? e.target.value : c)))} />
              </Field>
            ))}

            <fieldset className="rounded-xl border border-line p-4 flex flex-col gap-4">
              <legend className="px-1 text-sm font-semibold">למי לשלוח</legend>
              <div>
                <div className="text-sm mb-1.5">סוגים (מספיק אחד מהם)</div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {types.map((x) => <label key={x.code} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="types" value={x.code} className="accent-[var(--color-brand)]" />{x.label}</label>)}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="members_active" className="accent-[var(--color-brand)]" />רק חברי עמותה פעילים (שילמו בשנה האחרונה)</label>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="pink" className="accent-[var(--color-pink)]" />רק הרשימה הורודה</label>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="מחזורים" htmlFor="b-cohorts" hint="אפשר לבחור כמה (Ctrl/⌘)">
                  <select id="b-cohorts" name="cohort_ids" multiple className="w-full rounded-lg border border-control bg-surface px-2 py-1 text-sm h-28">
                    {cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="אזורים" htmlFor="b-regions">
                  <select id="b-regions" name="region_ids" multiple className="w-full rounded-lg border border-control bg-surface px-2 py-1 text-sm h-28">
                    {regions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="יישוב" htmlFor="b-city"><Input id="b-city" name="city" maxLength={60} /></Field>
              </div>
            </fieldset>
            {st.error && <p role="alert" className="text-sm text-danger">{st.error}</p>}
            <div><SubmitButton>שמירת טיוטה ושליחה לאישור</SubmitButton></div>
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="text-sm font-semibold mb-1">קהל</div>
              {pending && !count ? <p className="text-sm text-ink-3">מחשב…</p> : count ? (
                <>
                  <p className="text-3xl font-extrabold text-brand">{count.consented.toLocaleString("he-IL")}</p>
                  <p className="text-[13px] text-ink-3">יקבלו את ההודעה (הסכימו לקבל הודעות).{count.total > count.consented && <> עוד {(count.total - count.consented).toLocaleString("he-IL")} מתאימים לסינון אבל לא הסכימו — לא יקבלו.</>}</p>
                </>
              ) : <p className="text-sm text-ink-3">—</p>}
            </div>
            <div className="rounded-xl border border-line bg-[#e7f6e3] p-4">
              <div className="text-[12px] text-ink-3 mb-1.5">תצוגה מקדימה</div>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed bg-white rounded-lg p-3 shadow-sm">{preview || "בחרו תבנית"}</p>
            </div>
          </aside>
        </>
      )}
    </ActionForm>
  );
}
