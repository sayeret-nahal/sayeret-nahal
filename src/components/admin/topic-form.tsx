"use client";

import { Field, Input, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { saveTopic } from "@/app/(app)/admin/inquiry-topics/actions";

export type Topic = { code: string; label: string; description: string | null; priority: string; assignee_id: string | null; active: boolean; sort_key: number };
const PRIORITY: Record<string, string> = { normal: "רגילה", high: "גבוהה", urgent: "דחופה" };

export function TopicForm({ t, staff }: { t?: Topic; staff: { id: string; full_name: string }[] }) {
  const p = t ? `t-${t.code}` : "t-new";
  return (
    <ActionForm action={saveTopic} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_auto_1fr_auto_auto] items-end" closeOnSuccess={false}>
      {(st) => (
        <>
          {t ? <input type="hidden" name="code" value={t.code} /> : (
            <Field label="קוד (באנגלית)" htmlFor={`${p}-code`} error={st.fieldErrors?.code}><Input id={`${p}-code`} name="code" dir="ltr" required /></Field>
          )}
          <Field label="שם הנושא" htmlFor={`${p}-label`} error={st.fieldErrors?.label}><Input id={`${p}-label`} name="label" defaultValue={t?.label} required maxLength={60} /></Field>
          <Field label="הסבר קצר" htmlFor={`${p}-desc`} error={st.fieldErrors?.description}><Input id={`${p}-desc`} name="description" defaultValue={t?.description ?? ""} maxLength={200} /></Field>
          <Field label="עדיפות" htmlFor={`${p}-prio`}>
            <Select id={`${p}-prio`} name="priority" defaultValue={t?.priority ?? "normal"} className="w-auto">
              {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="אחראי/ת" htmlFor={`${p}-owner`} hint="הפנייה תשויך אליו/ה אוטומטית">
            <Select id={`${p}-owner`} name="assignee_id" defaultValue={t?.assignee_id ?? ""}>
              <option value="">ללא — לתור הפניות הכללי</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          </Field>
          <input type="hidden" name="sort_key" value={t?.sort_key ?? 100} />
          <label className="flex items-center gap-2 text-sm h-10"><input type="checkbox" name="active" defaultChecked={t?.active ?? true} className="accent-[var(--color-brand)]" /> פעיל</label>
          <div className="flex items-center gap-2 h-10">
            <SubmitButton size="sm" variant={t ? "secondary" : "primary"}>{t ? "שמירה" : "הוספה"}</SubmitButton>
            {st.message && <span role="status" className="text-[12px] text-ok">{st.message}</span>}
            {st.error && <span role="alert" className="text-[12px] text-danger">{st.error}</span>}
          </div>
        </>
      )}
    </ActionForm>
  );
}
