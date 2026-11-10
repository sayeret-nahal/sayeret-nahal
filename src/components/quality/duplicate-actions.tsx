"use client";

import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/ui/client";
import { markNotDuplicate, mergePair } from "@/app/(app)/contacts/quality/actions";

type Side = { id: string; name: string; created: string };

/** Merge / "not the same person" buttons for one suggested pair. `a` is shown first (right on desktop, top on mobile). */
export function DuplicateActions({ a, b, canMerge, nameOnly }: { a: Side; b: Side; canMerge: boolean; nameOnly: boolean }) {
  const confirmText = (keep: Side, drop: Side) =>
    [
      nameOnly ? "שימו לב: ההתאמה מבוססת על דמיון בשם בלבד. ודאו שזה באמת אותו אדם.\n" : "",
      `לאחד את הרשומות ולהשאיר את "${keep.name}" (נוצרה ${keep.created})?`,
      "",
      `• כל ההיסטוריה של "${drop.name}" — שיחות, פניות, משימות, תרומות ותגיות — תעבור לרשומה שנשארת.`,
      "• שדות ריקים ברשומה שנשארת יושלמו מהרשומה השנייה. ערכים קיימים לא יוחלפו (טלפון שונה יישמר בהערות).",
      `• הרשומה "${drop.name}" תועבר לארכיון ותישמר לתיעוד, ולא תופיע יותר ברשימות.`,
    ].join("\n");

  return (
    <div className="flex flex-wrap items-start gap-2">
      {canMerge && (
        <>
          <ActionForm action={mergePair}>
            <input type="hidden" name="keep" value={a.id} />
            <input type="hidden" name="drop" value={b.id} />
            <ConfirmSubmit variant="secondary" message={confirmText(a, b)}>
              איחוד — להשאיר את <span className="hidden md:inline">הימנית</span><span className="md:hidden">העליונה</span>
              <span className="sr-only"> ({a.name}, נוצרה {a.created})</span>
            </ConfirmSubmit>
          </ActionForm>
          <ActionForm action={mergePair}>
            <input type="hidden" name="keep" value={b.id} />
            <input type="hidden" name="drop" value={a.id} />
            <ConfirmSubmit variant="secondary" message={confirmText(b, a)}>
              איחוד — להשאיר את <span className="hidden md:inline">השמאלית</span><span className="md:hidden">התחתונה</span>
              <span className="sr-only"> ({b.name}, נוצרה {b.created})</span>
            </ConfirmSubmit>
          </ActionForm>
        </>
      )}
      <ActionForm action={markNotDuplicate}>
        <input type="hidden" name="a" value={a.id} />
        <input type="hidden" name="b" value={b.id} />
        <SubmitButton variant="quiet" size="sm" pendingText="שומר…">זה לא אותו אדם</SubmitButton>
      </ActionForm>
    </div>
  );
}
