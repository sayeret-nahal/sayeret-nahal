"use client";

import { useId, useState } from "react";
import { Field, Select } from "@/components/ui";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/labels";
import type { AppRole, Lookup } from "@/lib/types";
import { ROLE_ORDER } from "./permission-matrix";

function ScopeGroup({ legend, name, items, selected }: { legend: string; name: string; items: Lookup[]; selected: number[] }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-[13px] font-medium text-ink mb-1.5">{legend}</legend>
      {items.length === 0 ? (
        <p className="text-[12px] text-ink-3">אין עדיין פריטים ברשימה. אפשר להוסיף בעמוד &quot;רשימות&quot;.</p>
      ) : (
        <div className="max-h-44 overflow-y-auto rounded-lg border border-line-strong p-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {items.map((it) => (
            <label key={it.id} className="flex items-center gap-2 text-sm min-h-8 cursor-pointer">
              <input type="checkbox" name={name} value={it.id} defaultChecked={selected.includes(it.id)} className="size-4 accent-[var(--color-brand)]" />
              <span className="truncate">{it.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Role select with a plain-language description, plus cohort / region scope for cohort leads. */
export function RoleFields({ defaultRole = "volunteer", cohorts, regions, cohortScope = [], regionScope = [], errors }: {
  defaultRole?: AppRole; cohorts: Lookup[]; regions: Lookup[]; cohortScope?: number[]; regionScope?: number[];
  errors?: Record<string, string>;
}) {
  const id = useId();
  const [role, setRole] = useState<AppRole>(defaultRole);
  return (
    <>
      <Field label="תפקיד" htmlFor={`${id}-role`} required error={errors?.role}>
        <Select id={`${id}-role`} name="role" value={role} onChange={(e) => setRole(e.target.value as AppRole)} aria-describedby={`${id}-role-desc`}>
          {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </Select>
      </Field>
      <p id={`${id}-role-desc`} className="-mt-2 rounded-lg bg-muted-soft px-3 py-2 text-[13px] text-ink-2" aria-live="polite">
        {ROLE_DESCRIPTIONS[role]}
      </p>
      {role === "cohort_lead" && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-ink-2">בחרו את המחזורים ו/או האזורים שבאחריותו/ה. הוא/היא יראו רק אנשים מהתחום הזה (ואת מי שהוקצה להם אישית).</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ScopeGroup legend="מחזורים" name="cohort_scope" items={cohorts} selected={cohortScope} />
            <ScopeGroup legend="אזורים" name="region_scope" items={regions} selected={regionScope} />
          </div>
          {errors?.scope && <p role="alert" className="text-[12px] text-danger">{errors.scope}</p>}
        </div>
      )}
      {role === "volunteer" && (
        <p className="text-[12px] text-ink-3 -mt-1">מתנדב/ת רואה רק את האנשים שהוקצו לו/ה אישית (בשדה &quot;אחראי/ת קשר&quot; בכרטיס האדם).</p>
      )}
    </>
  );
}
