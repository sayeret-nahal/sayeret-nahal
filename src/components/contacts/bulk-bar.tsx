"use client";

import { useEffect, useState } from "react";
import { ActionForm, ConfirmSubmit } from "@/components/ui/client";
import { Select } from "@/components/ui";
import { bulkUpdate } from "@/app/(app)/contacts/actions";
import type { CareStatus, ContactType, Lookup, Staff } from "@/lib/types";

/** Bulk-edit bar. Works with checkboxes named "ids" that carry form="bulk-form". */
export function BulkBar({ staff, cohorts, regions, types, statuses, canSeeCare }: {
  staff: Staff[]; cohorts: Lookup[]; regions: Lookup[]; types: ContactType[]; statuses: CareStatus[]; canSeeCare: boolean;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(document.querySelectorAll<HTMLInputElement>('input[name="ids"][form="bulk-form"]:checked').length);
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  }, []);
  return (
    <div className={count ? "sticky bottom-16 lg:bottom-4 z-20 mt-4" : "hidden"}>
      <ActionForm action={bulkUpdate} id="bulk-form" className="rounded-[var(--radius-card)] border border-brand/30 bg-surface shadow-lg p-3 flex flex-wrap items-center gap-2"
        onSuccess={() => { document.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((i) => (i.checked = false)); setCount(0); }}>
        <span className="text-sm font-medium me-2">נבחרו {count}</span>
        <Select name="owner_id" aria-label="אחראי/ת" className="w-auto h-9" defaultValue="__keep">
          <option value="__keep">אחראי/ת: ללא שינוי</option>
          <option value="__none">הסרת אחראי</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </Select>
        <Select name="cohort_id" aria-label="מחזור" className="w-auto h-9" defaultValue="__keep">
          <option value="__keep">מחזור: ללא שינוי</option>
          {cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Select name="region_id" aria-label="אזור" className="w-auto h-9" defaultValue="__keep">
          <option value="__keep">אזור: ללא שינוי</option>
          {regions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Select name="add_type" aria-label="הוספת סוג קשר" className="w-auto h-9" defaultValue="">
          <option value="">הוספת סוג: ללא</option>
          {types.filter((t) => canSeeCare || !t.is_sensitive).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </Select>
        {canSeeCare && (
          <Select name="status_code" aria-label="מצב קשר" className="w-auto h-9" defaultValue="">
            <option value="">מצב: ללא שינוי</option>
            {statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </Select>
        )}
        <ConfirmSubmit variant="secondary" message={`לעדכן ${count} אנשים בבת אחת? אפשר לשנות כל אחד מהם אחר כך, אבל אין ביטול אוטומטי.`}>עדכון {count}</ConfirmSubmit>
      </ActionForm>
    </div>
  );
}
