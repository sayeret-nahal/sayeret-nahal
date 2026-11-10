import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/import/import-wizard";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { formatDateTime } from "@/lib/dates";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ייבוא מקובץ" };

type Batch = {
  id: string; kind: "contacts" | "donations"; file_name: string | null; created_by: string | null; created_at: string;
  rows_total: number; created_count: number; updated_count: number; skipped_count: number;
};

export default async function ImportPage() {
  const { staff } = await requireStaff();
  const role = staff.role;
  if (!perms.importData(role)) {
    return (
      <>
        <PageHeader title="ייבוא מקובץ" back={{ href: "/contacts", label: "אנשים" }} />
        <Notice tone="warn" title="אין לך הרשאה לייבא נתונים">ייבוא קבצים זמין למנהלי העמותה, לרכזי הקהילה ולרכזי התורמים. אם צריך לייבא רשימה, פנו אליהם.</Notice>
      </>
    );
  }
  const lookups = await getLookups();
  const supabase = await createClient();
  const { data: batches } = await supabase.from("import_batches")
    .select("id,kind,file_name,created_by,created_at,rows_total,created_count,updated_count,skipped_count")
    .order("created_at", { ascending: false }).limit(5).returns<Batch[]>();
  const seeCare = perms.seeCare(role);

  return (
    <>
      <PageHeader
        title="ייבוא מקובץ"
        back={{ href: "/contacts", label: "אנשים" }}
        description="מעלים קובץ אקסל או CSV, בודקים מה יקרה לכל שורה, ורק אז שומרים. המערכת לא מוחקת ולא דורסת מידע קיים."
      />
      <ImportWizard
        canDonations={perms.manageDonors(role)}
        isAdmin={perms.admin(role)}
        ownerLocked={role === "donor_coordinator"}
        types={lookups.types.filter((t) => seeCare || !t.is_sensitive).map((t) => ({ code: t.code, label: t.label }))}
        cohorts={lookups.cohorts.map((c) => ({ id: c.id, label: c.label }))}
        regions={lookups.regions.map((r) => ({ id: r.id, label: r.label }))}
        staff={lookups.staff.map((s) => ({ id: s.id, name: s.full_name }))}
      />

      <Card className="mt-8">
        <CardHeader title="ייבואים אחרונים" subtitle="כל ייבוא נשמר ביומן עם סיכום ורשימת השורות שלא יובאו." />
        {!batches?.length ? (
          <EmptyState title="עדיין לא בוצע ייבוא">אחרי הייבוא הראשון יופיע כאן סיכום שלו.</EmptyState>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {batches.map((b) => (
              <li key={b.id} className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{b.kind === "donations" ? "תרומות" : "אנשים"}</span>
                  {b.file_name && <span className="text-ink-2"> · <bdi>{b.file_name}</bdi></span>}
                  <div className="text-[12px] text-ink-3">{formatDateTime(b.created_at)}{b.created_by ? ` · ${lookups.staffName(b.created_by)}` : ""}</div>
                </div>
                <div className="text-[13px] text-ink-2 tabular-nums">
                  {b.rows_total.toLocaleString("he-IL")} שורות · {b.created_count.toLocaleString("he-IL")} נוספו · {b.updated_count.toLocaleString("he-IL")} הושלמו · {b.skipped_count.toLocaleString("he-IL")} לא יובאו
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
