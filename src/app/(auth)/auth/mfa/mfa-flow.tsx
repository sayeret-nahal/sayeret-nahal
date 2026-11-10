"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Field, Input } from "@/components/ui";

type Step = { kind: "loading" } | { kind: "enroll"; factorId: string; qr: string; secret: string } | { kind: "verify"; factorId: string };

/** Supabase returns the QR as "data:image/svg+xml;utf-8,<svg…>", which some browsers refuse; re-encode as base64. */
function qrSrc(qr: string): string {
  let s = qr;
  if (!s.includes("<svg")) {
    try { s = decodeURIComponent(s); } catch { return qr; }
  }
  const i = s.indexOf("<svg");
  if (i < 0) return qr;
  const bytes = new TextEncoder().encode(s.slice(i));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return "data:image/svg+xml;base64," + btoa(bin);
}

export function MfaFlow() {
  const supabase = createClient();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) { router.replace("/login"); return; }
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) { setStep({ kind: "verify", factorId: verified.id }); return; }
      // clean up half-finished enrolments, then start a new one
      for (const f of data.all.filter((f) => f.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const en = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `crm-${Date.now()}` });
      if (en.error) { setError("לא הצלחנו להתחיל הגדרה. רעננו את הדף."); return; }
      setStep({ kind: "enroll", factorId: en.data.id, qr: qrSrc(en.data.totp.qr_code), secret: en.data.totp.secret });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind === "loading") return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: step.factorId, code: code.trim() });
    setBusy(false);
    if (error) { setError("הקוד שגוי או שפג תוקפו. נסו את הקוד הבא שמופיע באפליקציה."); return; }
    await supabase.rpc("log_access", { p_action: "mfa_verified", p_table: null, p_record: null, p_details: null });
    router.replace("/");
    router.refresh();
  }

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold mb-1">אימות דו-שלבי</h1>
      {step.kind === "loading" && <p className="text-sm text-ink-2" aria-live="polite">טוען…</p>}
      {step.kind === "enroll" && (
        <div className="text-sm text-ink-2 space-y-3 mb-4">
          <p>המערכת מכילה מידע רגיש, ולכן הכניסה מוגנת בקוד מאפליקציית אימות (Google Authenticator, Microsoft Authenticator או דומה).</p>
          <ol className="list-decimal ps-5 space-y-1">
            <li>פתחו את אפליקציית האימות והוסיפו חשבון.</li>
            <li>סרקו את הקוד:</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={step.qr} alt="קוד QR להגדרת אפליקציית האימות" className="mx-auto size-44 bg-white rounded-lg border border-line" />
          <p>לא מצליחים לסרוק? הקלידו את המפתח: <code dir="ltr" className="font-mono text-[12px] break-all bg-muted-soft px-1 rounded">{step.secret}</code></p>
          <ol start={3} className="list-decimal ps-5"><li>הקלידו את הקוד בן 6 הספרות שמופיע באפליקציה.</li></ol>
        </div>
      )}
      {step.kind === "verify" && <p className="text-sm text-ink-2 mb-4">הקלידו את הקוד בן 6 הספרות מאפליקציית האימות.</p>}
      {step.kind !== "loading" && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="קוד אימות" htmlFor="code" required error={error ?? undefined}>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required dir="ltr"
              className="text-center tracking-[0.4em] text-lg" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
          </Field>
          <Button type="submit" variant="primary" disabled={busy || code.length !== 6}>{busy ? "בודק…" : "אישור"}</Button>
        </form>
      )}
      {error && step.kind === "loading" && <p role="alert" className="text-sm text-danger mt-3">{error}</p>}
      <div className="mt-5 pt-4 border-t border-line text-[13px] text-ink-2 flex flex-wrap items-center justify-between gap-2">
        <span>אין גישה לאפליקציה? פנו למנהל/ת המערכת.</span>
        <button type="button" className="text-brand hover:underline" onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>יציאה</button>
      </div>
    </Card>
  );
}
