"use client";

import { useId } from "react";
import { Input, Select } from "@/components/ui";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/ui/client";
import {
  deleteCohort, deleteRegion, saveCareStatus, saveCohort, saveContactType, saveRegion,
} from "@/app/(app)/admin/lookups/actions";

const small = "h-9";
const lbl = "text-[12px] text-ink-2";

export interface LookupItem { id: number; label: string; sort_key: number; active?: boolean }

/** One cohort or region: rename, reorder, (cohorts) mark inactive, delete when unused. */
export function LookupRow({ kind, item }: { kind: "cohort" | "region"; item: LookupItem }) {
  const id = useId();
  const noun = kind === "cohort" ? "המחזור" : "האזור";
  return (
    <div className="px-5 py-3">
      <div className="flex flex-wrap items-end gap-2 [&_p]:basis-full [&_p]:mt-1">
        <ActionForm action={kind === "cohort" ? saveCohort : saveRegion} className="contents">
          <input type="hidden" name="id" value={item.id} />
          <div className="flex flex-col gap-1 flex-1 min-w-40">
            <label htmlFor={`${id}-label`} className={lbl}>שם</label>
            <Input id={`${id}-label`} name="label" defaultValue={item.label} required maxLength={60} className={small} />
          </div>
          <div className="flex flex-col gap-1 w-20">
            <label htmlFor={`${id}-sort`} className={lbl}>סדר</label>
            <Input id={`${id}-sort`} name="sort_key" type="number" step={1} min={-9999} max={9999} defaultValue={item.sort_key} className={small} />
          </div>
          {kind === "cohort" && (
            <label className="inline-flex items-center gap-2 text-sm h-9 px-1 cursor-pointer">
              <input type="checkbox" name="active" defaultChecked={item.active !== false} className="size-4 accent-[var(--color-brand)]" />
              פעיל
            </label>
          )}
          <SubmitButton variant="secondary" size="sm" className="h-9">שמירה<span className="sr-only"> של {item.label}</span></SubmitButton>
        </ActionForm>
        <ActionForm action={kind === "cohort" ? deleteCohort : deleteRegion} className="contents">
          <input type="hidden" name="id" value={item.id} />
          <ConfirmSubmit message={`למחוק את ${noun} "${item.label}"? אם הוא בשימוש, המחיקה תיחסם ותקבלו הסבר.`} variant="secondary">
            מחיקה<span className="sr-only"> של {item.label}</span>
          </ConfirmSubmit>
        </ActionForm>
      </div>
    </div>
  );
}

export function AddLookupForm({ kind }: { kind: "cohort" | "region" }) {
  const id = useId();
  return (
    <ActionForm action={kind === "cohort" ? saveCohort : saveRegion} resetOnSuccess className="px-5 py-4 bg-canvas/60 border-t border-line">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 flex-1 min-w-40">
          <label htmlFor={`${id}-label`} className={lbl}>{kind === "cohort" ? "מחזור חדש" : "אזור חדש"}</label>
          <Input id={`${id}-label`} name="label" required maxLength={60} placeholder={kind === "cohort" ? "לדוגמה: מחזור אוגוסט 2024" : "לדוגמה: גליל עליון"} className={small} />
        </div>
        <div className="flex flex-col gap-1 w-20">
          <label htmlFor={`${id}-sort`} className={lbl}>סדר</label>
          <Input id={`${id}-sort`} name="sort_key" type="number" step={1} min={-9999} max={9999} defaultValue={0} className={small} />
        </div>
        <SubmitButton size="sm" className="h-9">הוספה</SubmitButton>
      </div>
    </ActionForm>
  );
}

export const SEVERITY_LABELS = ["רגיל", "דורש תשומת לב", "מעקב צמוד", "דחוף"] as const;

export function CareStatusRow({ item }: { item: { code: string; label: string; cadence_days: number | null; severity: number } }) {
  const id = useId();
  return (
    <ActionForm action={saveCareStatus} className="px-5 py-3">
      <input type="hidden" name="code" value={item.code} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 flex-1 min-w-40">
          <label htmlFor={`${id}-label`} className={lbl}>שם המצב <span className="text-ink-3" dir="ltr">({item.code})</span></label>
          <Input id={`${id}-label`} name="label" defaultValue={item.label} required maxLength={60} className={small} />
        </div>
        <div className="flex flex-col gap-1 w-32">
          <label htmlFor={`${id}-cad`} className={lbl}>שיחה כל (ימים)</label>
          <Input id={`${id}-cad`} name="cadence_days" type="number" step={1} min={1} max={730} defaultValue={item.cadence_days ?? ""} placeholder="90" className={small} aria-describedby={`${id}-cad-hint`} />
          <span id={`${id}-cad-hint`} className="sr-only">ריק = כל 90 ימים</span>
        </div>
        <div className="flex flex-col gap-1 w-40">
          <label htmlFor={`${id}-sev`} className={lbl}>דחיפות</label>
          <Select id={`${id}-sev`} name="severity" defaultValue={String(item.severity)} className={small}>
            {SEVERITY_LABELS.map((l, i) => <option key={i} value={i}>{i} · {l}</option>)}
          </Select>
        </div>
        <SubmitButton variant="secondary" size="sm" className="h-9">שמירה<span className="sr-only"> של {item.label}</span></SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ContactTypeRow({ item }: { item: { code: string; label: string; is_sensitive: boolean } }) {
  const id = useId();
  return (
    <ActionForm action={saveContactType} className="px-5 py-3">
      <input type="hidden" name="code" value={item.code} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 flex-1 min-w-40">
          <label htmlFor={`${id}-label`} className={lbl}>שם הסוג <span className="text-ink-3" dir="ltr">({item.code})</span></label>
          <Input id={`${id}-label`} name="label" defaultValue={item.label} required maxLength={60} className={small} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm h-9 px-1 cursor-pointer">
          <input type="checkbox" name="is_sensitive" defaultChecked={item.is_sensitive} disabled={item.code === "donor"} className="size-4 accent-[var(--color-brand)]" />
          רגיש
        </label>
        <SubmitButton variant="secondary" size="sm" className="h-9">שמירה<span className="sr-only"> של {item.label}</span></SubmitButton>
      </div>
    </ActionForm>
  );
}
