"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { saveTemplate } from "@/app/(app)/broadcasts/actions";

const VARS = [["", "—"], ["first_name", "שם פרטי"], ["full_name", "שם מלא"], ["cohort", "מחזור"], ["city", "יישוב"], ["custom", "טקסט קבוע (נכתב בכל שליחה)"]];

export function TemplateForm() {
  return (
    <ActionForm action={saveTemplate} className="px-5 pb-5 flex flex-col gap-3" resetOnSuccess closeOnSuccess={false}>
      {(st) => (
        <>
          <Field label="שם" htmlFor="tp-name" required error={st.fieldErrors?.name}><Input id="tp-name" name="name" required maxLength={80} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ערוץ" htmlFor="tp-ch"><Select id="tp-ch" name="channel"><option value="whatsapp">וואטסאפ</option><option value="sms">SMS</option></Select></Field>
            <Field label="סוג" htmlFor="tp-cat"><Select id="tp-cat" name="category"><option value="marketing">שיווקית / בקשת תרומה</option><option value="utility">עדכון שירות</option></Select></Field>
          </div>
          <Field label="מזהה התבנית ב-019" htmlFor="tp-id" error={st.fieldErrors?.provider_template} hint="חובה בוואטסאפ"><Input id="tp-id" name="provider_template" dir="ltr" maxLength={120} /></Field>
          <Field label="נוסח" htmlFor="tp-body" required error={st.fieldErrors?.body}
            hint={'משתנים: {{1}} עד {{5}}. הודעה שיווקית או בקשת תרומה מתחילה במילה "פרסומת" או "בקשת תרומה", וכוללת את שם העמותה ודרך להסרה.'}>
            <Textarea id="tp-body" name="body" required maxLength={1000} defaultValue={'פרסומת: שלום {{1}}, '} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Field key={i} label={`{{${i}}}`} htmlFor={`tp-v${i}`}>
                <Select id={`tp-v${i}`} name={`var_${i}`} defaultValue={i === 1 ? "first_name" : ""}>{VARS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              </Field>
            ))}
          </div>
          {st.message && <p role="status" className="text-sm text-ok">{st.message}</p>}
          <SubmitButton>שמירה</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
