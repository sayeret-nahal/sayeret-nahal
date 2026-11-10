import type { Metadata } from "next";
import { Notice, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/components/admin/guard";
import { SettingsForm, type SettingsValues } from "@/components/admin/settings-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "הגדרות" };

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);

export default async function AdminSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("key,value");
  const m = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]));

  // Defaults mirror supabase/migrations/0004_reference_data.sql
  const values: SettingsValues = {
    org_name: str(m.get("org_name"), "עמותת סיירת נחל"),
    talk_response_hours: num(m.get("talk_response_hours"), 24),
    talk_response_text: str(m.get("talk_response_text")),
    concern_response_hours: num(m.get("concern_response_hours"), 48),
    request_sla_days: num(m.get("request_sla_days"), 7),
    idle_timeout_minutes: num(m.get("idle_timeout_minutes"), 30),
    stale_after_days: num(m.get("stale_after_days"), 365),
    emergency_text: str(m.get("emergency_text")),
    privacy_notice_text: str(m.get("privacy_notice_text")),
    privacy_notice_version: str(m.get("privacy_notice_version")),
    require_mfa: m.get("require_mfa") !== false,
  };

  return (
    <>
      <PageHeader title="הגדרות" description="זמני תגובה, טקסטים בטפסים הציבוריים ואבטחה." back={{ href: "/admin", label: "ניהול" }} />
      {error ? (
        <Notice tone="danger" title="לא הצלחנו לטעון את ההגדרות">רעננו את הדף ונסו שוב.</Notice>
      ) : (
        <>
          {!values.require_mfa && (
            <div className="mb-6">
              <Notice tone="danger" title="האימות הדו-שלבי כבוי">כל מי שיודע/ת סיסמה של חבר/ת צוות יכול/ה להיכנס. הפעילו אותו מחדש בהקדם.</Notice>
            </div>
          )}
          {(values.privacy_notice_version.startsWith("draft") || values.privacy_notice_text.includes("טיוטה")) && (
            <div className="mb-6">
              <Notice tone="warn" title="נוסח הודעת הפרטיות הוא עדיין טיוטה">
                הנוסח מוצג בטפסים הציבוריים. יש לאשר אותו מול עורך/ת דין ולעדכן כאן לפני פרסום הקישורים.
              </Notice>
            </div>
          )}
          <SettingsForm values={values} />
        </>
      )}
    </>
  );
}
