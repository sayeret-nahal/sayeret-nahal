import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice, PageHeader } from "@/components/ui";
import { NewCaseForm } from "@/components/cases/new-case-form";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { todayIL } from "@/lib/dates";

export const metadata: Metadata = { title: "פנייה חדשה" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hoursText(h: number): string {
  if (h % 24 === 0) {
    const d = h / 24;
    return d === 1 ? "תוך יום" : d === 2 ? "תוך יומיים" : `תוך ${d} ימים`;
  }
  return h === 1 ? "תוך שעה" : h === 2 ? "תוך שעתיים" : `תוך ${h} שעות`;
}

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ contact?: string; kind?: string }> }) {
  const { staff, userId } = await requireStaff();
  if (!perms.seeCases(staff.role)) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();

  const [lookups, contactRes, settingsRes] = await Promise.all([
    getLookups(),
    sp.contact && UUID_RE.test(sp.contact)
      ? supabase.from("contacts").select("id, full_name").eq("id", sp.contact).is("merged_into", null).maybeSingle<{ id: string; full_name: string }>()
      : Promise.resolve({ data: null }),
    supabase.from("settings").select("key, value").in("key", ["request_sla_days", "concern_response_hours"]),
  ]);

  const contact = contactRes.data ? { id: contactRes.data.id, name: contactRes.data.full_name } : null;
  const contactMissing = !!sp.contact && !contact;
  const kind = sp.kind === "concern" ? "concern" : "request";

  const setting = (k: string) => {
    const v = Number((settingsRes.data ?? []).find((r) => r.key === k)?.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const days = setting("request_sla_days");
  const hours = setting("concern_response_hours");
  const slaText = days && hours
    ? { request: `${days === 1 ? "תוך יום" : days === 2 ? "תוך יומיים" : `תוך ${days} ימים`} מהפתיחה`, concern: `${hoursText(hours)} מהפתיחה` }
    : null;

  return (
    <>
      <PageHeader
        title={kind === "concern" ? "דיווח חשש חדש" : "פנייה חדשה"}
        back={contact ? { href: `/contacts/${contact.id}`, label: contact.name } : { href: "/cases", label: "פניות" }}
        description={contact ? <>עבור <strong className="text-ink">{contact.name}</strong>. כל מה שיתועד כאן יופיע גם בכרטיס שלו/ה.</> : "רושמים בקצרה מה צריך, ומי מטפל. המערכת תזכיר אם משהו נתקע."}
      />
      {contactMissing && (
        <div className="mb-4 max-w-3xl">
          <Notice tone="warn" title="לא מצאנו את האדם מהקישור">ייתכן שאין לך הרשאה לראות אותו. אפשר לחפש אותו כאן למטה או לכתוב שם וטלפון.</Notice>
        </div>
      )}
      <NewCaseForm
        staff={lookups.staff.filter((s) => perms.seeCases(s.role)).map((s) => ({ id: s.id, full_name: s.full_name }))}
        currentUserId={userId}
        contact={contact}
        defaultKind={kind}
        slaText={slaText}
        today={todayIL()}
      />
    </>
  );
}
