"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Field, Input, Select } from "@/components/ui";
import { addFamilyMember } from "@/app/(app)/calendar/actions";
import { PersonPicker } from "./person-picker";

export function FamilyForm({ fallenId, onDone }: { fallenId: string; onDone?: () => void }) {
  const [relation, setRelation] = useState("");
  return (
    <ActionForm action={addFamilyMember} onSuccess={() => onDone?.()} className="flex flex-col gap-4">
      {(state) => {
        const fe = state.fieldErrors ?? {};
        return (
          <>
            <input type="hidden" name="fallen_id" value={fallenId} />
            <Field label="בן/בת המשפחה" htmlFor="family-person" required error={fe.contact_id}
              hint="מחפשים מתוך האנשים במערכת. אם האדם עוד לא קיים, יש להוסיף אותו קודם בדף אנשים.">
              <PersonPicker id="family-person" name="contact_id" required invalid={!!fe.contact_id} describedBy={fe.contact_id ? "family-person-error" : "family-person-hint"} />
            </Field>
            <Field label="קרבה" htmlFor="family-relation" required error={fe.relation}>
              <Select id="family-relation" name="relation" required value={relation} onChange={(e) => setRelation(e.target.value)}>
                <option value="" disabled>בחירה…</option>
                <option value="הורה">הורה</option>
                <option value="בן/בת זוג">בן/בת זוג</option>
                <option value="אח/ות">אח/ות</option>
                <option value="ילד/ה">ילד/ה</option>
                <option value="other">אחר</option>
              </Select>
            </Field>
            {relation === "other" && (
              <Field label="פירוט הקרבה" htmlFor="family-relation-other">
                <Input id="family-relation-other" name="relation_other" maxLength={40} placeholder="לדוגמה: דוד, סבתא" />
              </Field>
            )}
            <SubmitButton>קישור למשפחה</SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}
