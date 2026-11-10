"use client";

import { Checkbox } from "@/components/ui";
import { ActionForm, ConfirmSubmit } from "@/components/ui/client";
import { deleteDemoData } from "@/app/(app)/admin/demo/actions";

export function DemoDeleteForm({ total }: { total: number }) {
  return (
    <ActionForm action={deleteDemoData} className="flex flex-col gap-4">
      <Checkbox name="confirm" required label={'הבנתי: כל הרשומות המסומנות כ"דוגמה" יימחקו לצמיתות, יחד עם התיעוד, המשימות והתגיות שלהן.'} />
      <div>
        <ConfirmSubmit size="md" message={`למחוק לצמיתות ${total.toLocaleString("he-IL")} רשומות דוגמה? אי אפשר לבטל את הפעולה.`}>
          מחיקת כל נתוני הדוגמה
        </ConfirmSubmit>
      </div>
    </ActionForm>
  );
}
