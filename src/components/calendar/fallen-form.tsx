"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { saveFallen } from "@/app/(app)/calendar/actions";
import type { Fallen, Lookup, Staff } from "@/lib/types";

export function FallenForm({ fallen, cohorts, staff, maxDate, onDone }: {
  fallen?: Fallen; cohorts: Lookup[]; staff: Pick<Staff, "id" | "full_name">[]; maxDate: string; onDone?: () => void;
}) {
  const p = fallen ? "fallen-edit" : "fallen-new";
  return (
    <ActionForm action={saveFallen} onSuccess={() => onDone?.()} className="flex flex-col gap-4">
      {(state) => {
        const fe = state.fieldErrors ?? {};
        return (
          <>
            {fallen && <input type="hidden" name="id" value={fallen.id} />}
            <div className="grid grid-cols-2 gap-3">
              <Field label="שם פרטי" htmlFor={`${p}-first`} required error={fe.first_name}>
                <Input id={`${p}-first`} name="first_name" required maxLength={60} defaultValue={fallen?.first_name ?? ""} />
              </Field>
              <Field label="שם משפחה" htmlFor={`${p}-last`} required error={fe.last_name}>
                <Input id={`${p}-last`} name="last_name" required maxLength={60} defaultValue={fallen?.last_name ?? ""} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="מחזור" htmlFor={`${p}-cohort`}>
                <Select id={`${p}-cohort`} name="cohort_id" defaultValue={fallen?.cohort_id ?? ""}>
                  <option value="">לא ידוע</option>
                  {cohorts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </Field>
              <Field label="תאריך הנפילה" htmlFor={`${p}-death`} required error={fe.death_date}>
                <Input id={`${p}-death`} name="death_date" type="date" required max={maxDate} defaultValue={fallen?.death_date ?? ""} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="דרגה" htmlFor={`${p}-rank`} error={fe.rank}>
                <Input id={`${p}-rank`} name="rank" maxLength={60} defaultValue={fallen?.rank ?? ""} />
              </Field>
              <Field label="פלוגה / יחידה" htmlFor={`${p}-sub`} error={fe.sub_unit} hint='למשל פלס"ר, עורב, פלחה"ן'>
                <Input id={`${p}-sub`} name="sub_unit" maxLength={120} defaultValue={fallen?.sub_unit ?? ""} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="מקום מגורים" htmlFor={`${p}-res`} error={fe.residence} hint="משמש להתאמה לאנשים שגרים באותו יישוב">
                <Input id={`${p}-res`} name="residence" maxLength={120} defaultValue={fallen?.residence ?? ""} />
              </Field>
              <Field label="מקום קבורה" htmlFor={`${p}-burial`} error={fe.burial_place}>
                <Input id={`${p}-burial`} name="burial_place" maxLength={200} defaultValue={fallen?.burial_place ?? ""} />
              </Field>
            </div>
            <Field label="מלחמה / מבצע" htmlFor={`${p}-war`} error={fe.war_operation}>
              <Input id={`${p}-war`} name="war_operation" maxLength={200} defaultValue={fallen?.war_operation ?? ""} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="תאריך גיוס (כפי שמופיע במקור)" htmlFor={`${p}-enl`} error={fe.enlistment_text}>
                <Input id={`${p}-enl`} name="enlistment_text" maxLength={60} defaultValue={fallen?.enlistment_text ?? ""} />
              </Field>
              <Field label="שנת גיוס" htmlFor={`${p}-enly`} error={fe.enlistment_year}>
                <Input id={`${p}-enly`} name="enlistment_year" type="number" min={1940} max={2100} defaultValue={fallen?.enlistment_year ?? ""} />
              </Field>
            </div>
            <Field label="קישור למקור (יזכור)" htmlFor={`${p}-src`} error={fe.source_url}>
              <Input id={`${p}-src`} name="source_url" type="url" dir="ltr" maxLength={500} defaultValue={fallen?.source_url ?? ""} />
            </Field>
            <div className="rounded-lg border border-line bg-canvas px-3 py-3">
              <Checkbox
                name="after_sunset"
                defaultChecked={fallen?.after_sunset}
                label="נפל/ה אחרי השקיעה"
                hint="בלוח העברי היום מתחיל בשקיעה. אם הנפילה הייתה אחרי השקיעה, התאריך העברי הוא של היום הבא — וכך גם יום האזכרה. אם לא ידוע, השאירו לא מסומן."
              />
            </div>
            <Field label="אחראי/ת על הקשר עם המשפחה" htmlFor={`${p}-owner`} hint="יקבל/תקבל את משימות התזכורת לפני יום האזכרה">
              <Select id={`${p}-owner`} name="owner_id" defaultValue={fallen?.owner_id ?? ""}>
                <option value="">ללא אחראי</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </Select>
            </Field>
            <Field label="הערות" htmlFor={`${p}-notes`} error={fe.notes} hint="מידע שימושי לארגון בלבד (למשל מקום הטקס). לא לרשום נסיבות, מידע רפואי או פרטים רגישים על המשפחה.">
              <Textarea id={`${p}-notes`} name="notes" maxLength={2000} defaultValue={fallen?.notes ?? ""} />
            </Field>
            <SubmitButton>{fallen ? "שמירת שינויים" : "הוספה לרשימה"}</SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}
