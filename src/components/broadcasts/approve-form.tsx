"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { approveAndSend } from "@/app/(app)/broadcasts/actions";

export function ApproveForm({ id }: { id: string }) {
  return (
    <ActionForm action={approveAndSend} className="px-5 pb-5 pt-3 flex flex-col gap-3" closeOnSuccess={false}>
      {(st) => (
        <>
          <input type="hidden" name="id" value={id} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1 accent-[var(--color-brand)]" />
            <span>בדקתי את התוכן ואת הקהל. ההודעה תישלח רק למי שהסכים/ה, ומי שישיב &quot;הסר&quot; יוסר אוטומטית.</span></label>
          {st.message && <p role="status" className="text-sm text-ok">{st.message}</p>}
          <div className="flex gap-2">
            <SubmitButton pendingText="מאשר…">אישור ושליחה</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
