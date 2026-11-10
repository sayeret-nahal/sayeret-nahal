"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { CopyButton } from "@/components/ui/client";
import { createUpdateLink } from "@/app/(app)/contacts/actions";
import { whatsappLink } from "@/lib/phone";

export function UpdateLinkButton({ contactId, phone, firstName }: { contactId: string; phone: string | null; firstName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!url) {
    return (
      <div>
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          if (!window.confirm("ליצור קישור אישי חדש לעדכון פרטים? אם נשלח קישור קודם, הוא יבוטל.")) return;
          const r = await createUpdateLink(contactId);
          if (r.url) setUrl(r.url); else setError(r.error ?? "שגיאה");
        })}>
          {pending ? "יוצר קישור…" : "קישור לעדכון פרטים"}
        </Button>
        {error && <p role="alert" className="text-[12px] text-danger mt-1">{error}</p>}
      </div>
    );
  }
  const msg = `שלום ${firstName}, כאן עמותת סיירת נחל. אנחנו מעדכנים את פרטי הקשר בקהילה — זה לוקח דקה: ${url} (הקישור אישי ובתוקף 30 יום)`;
  return (
    <div className="rounded-lg border border-line bg-canvas p-3 text-sm space-y-2">
      <p className="text-ink-2">קישור אישי לעדכון פרטים (בתוקף 30 יום, קישור קודם בוטל):</p>
      <p dir="ltr" className="font-mono text-[12px] break-all">{url}</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={url} label="העתקת קישור" />
        {phone && (
          <a className="inline-flex items-center h-8 px-3 rounded-lg text-[13px] font-medium bg-brand text-white" href={whatsappLink(phone, msg)} target="_blank" rel="noopener noreferrer">
            שליחה בוואטסאפ
          </a>
        )}
        {phone && (
          <a className="inline-flex items-center h-8 px-3 rounded-lg text-[13px] font-medium border border-control" href={`sms:${phone}?body=${encodeURIComponent(msg)}`}>
            שליחה ב-SMS
          </a>
        )}
      </div>
    </div>
  );
}
