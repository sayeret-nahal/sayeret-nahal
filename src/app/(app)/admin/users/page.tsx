import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { ConfirmSubmit, CopyButton } from "@/components/ui/client";
import { requireAdmin } from "@/components/admin/guard";
import { getAppUrl } from "@/components/admin/app-url";
import { PermissionMatrixTable } from "@/components/admin/permission-matrix-table";
import { EditStaffButton, InviteForm, ToggleActiveForm } from "@/components/admin/user-forms";
import { getLookups, type Lookups } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Staff } from "@/lib/types";
import { cancelInvite } from "./actions";

export const metadata: Metadata = { title: "משתמשים והרשאות" };

type StaffRow = Staff & { created_at: string };
type Invite = { email: string; full_name: string; role: AppRole; cohort_scope: number[]; region_scope: number[]; invited_by: string | null; created_at: string };

function scopeText(s: { cohort_scope: number[]; region_scope: number[] }, lookups: Lookups): string {
  const parts = [
    ...s.cohort_scope.map((id) => lookups.cohortLabel(id) || `מחזור #${id}`),
    ...s.region_scope.map((id) => lookups.regionLabel(id) || `אזור #${id}`),
  ];
  return parts.join(", ");
}

function StaffTable({ rows, lookups, userId, caption }: { rows: StaffRow[]; lookups: Lookups; userId: string; caption: string }) {
  return (
    <>
      <table className="hidden md:table w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-[12px] text-ink-3 border-b border-line">
          <tr>
            <th scope="col" className="text-start font-medium py-2.5 ps-5 pe-3">שם</th>
            <th scope="col" className="text-start font-medium px-3">תפקיד</th>
            <th scope="col" className="text-start font-medium px-3">תחום</th>
            <th scope="col" className="text-start font-medium px-3">מצב</th>
            <th scope="col" className="pe-5"><span className="sr-only">פעולות</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((s) => {
            const scope = scopeText(s, lookups);
            return (
              <tr key={s.id} className="align-middle">
                <td className="py-2.5 ps-5 pe-3">
                  <div className="font-medium text-ink">{s.full_name}{s.id === userId && <span className="text-ink-3 font-normal"> (אני)</span>}</div>
                  <div className="text-[12px] text-ink-3" dir="ltr" style={{ textAlign: "end" }}>{s.email}</div>
                </td>
                <td className="px-3 text-ink-2">{ROLE_LABELS[s.role]}</td>
                <td className="px-3 text-ink-2 max-w-56">{scope || <span className="text-ink-3">—</span>}</td>
                <td className="px-3">{s.is_active ? <Badge tone="ok">פעיל/ה</Badge> : <Badge>מושבת/ת</Badge>}</td>
                <td className="pe-5 py-2">
                  <div className="flex items-start justify-end gap-1">
                    {s.is_active && <EditStaffButton member={s} cohorts={lookups.cohorts} regions={lookups.regions} isSelf={s.id === userId} />}
                    <ToggleActiveForm member={s} isSelf={s.id === userId} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="md:hidden divide-y divide-line">
        {rows.map((s) => {
          const scope = scopeText(s, lookups);
          return (
            <li key={s.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{s.full_name}{s.id === userId && <span className="text-ink-3 font-normal"> (אני)</span>}</div>
                  <div className="text-[12px] text-ink-3 truncate" dir="ltr" style={{ textAlign: "end" }}>{s.email}</div>
                  <div className="text-[13px] text-ink-2 mt-0.5">{ROLE_LABELS[s.role]}{scope && ` · ${scope}`}</div>
                </div>
                {s.is_active ? <Badge tone="ok">פעיל/ה</Badge> : <Badge>מושבת/ת</Badge>}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {s.is_active && <EditStaffButton member={s} cohorts={lookups.cohorts} regions={lookups.regions} isSelf={s.id === userId} />}
                <ToggleActiveForm member={s} isSelf={s.id === userId} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default async function AdminUsersPage() {
  const { userId } = await requireAdmin();
  const supabase = await createClient();
  const [lookups, staffRes, invitesRes, app] = await Promise.all([
    getLookups(),
    supabase.from("staff").select("*").order("full_name").returns<StaffRow[]>(),
    supabase.from("staff_invites").select("*").order("created_at", { ascending: false }).returns<Invite[]>(),
    getAppUrl(),
  ]);
  const all = staffRes.data ?? [];
  const active = all.filter((s) => s.is_active);
  const inactive = all.filter((s) => !s.is_active);
  const invites = invitesRes.data ?? [];
  const nameOf = (id: string | null) => all.find((s) => s.id === id)?.full_name ?? "";
  const loginUrl = `${app.url}/login`;

  return (
    <>
      <PageHeader
        title="משתמשים והרשאות"
        description="מי יכול להיכנס למערכת ומה כל אחד רואה. כל שינוי חל מיד ונרשם ביומן הפעולות."
        back={{ href: "/admin", label: "ניהול" }}
        actions={
          <a href="/api/admin/permissions" download className={buttonClass("secondary", "sm")}>
            <Download className="size-4" aria-hidden />ייצוא רשימת הרשאות
          </a>
        }
      />

      {(staffRes.error || invitesRes.error) && <p role="alert" className="text-sm text-danger mb-4">חלק מהנתונים לא נטענו. רעננו את הדף.</p>}

      <div className="flex flex-col gap-6">
        <Card aria-labelledby="active-staff">
          <CardHeader id="active-staff" title={`צוות פעיל (${active.length})`} subtitle="השבתה חוסמת את הגישה מיד, בלי למחוק את ההיסטוריה של המשתמש/ת." />
          {active.length ? <StaffTable rows={active} lookups={lookups} userId={userId} caption="צוות פעיל" /> : <EmptyState title="אין משתמשים פעילים" />}
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card aria-labelledby="invite">
            <CardHeader id="invite" title="הזמנת משתמש/ת חדש/ה" subtitle="רק כתובת דוא״ל שהוזמנה כאן יכולה להירשם למערכת." />
            <div className="px-5 pb-5"><InviteForm cohorts={lookups.cohorts} regions={lookups.regions} /></div>
          </Card>

          <Card aria-labelledby="onboarding">
            <CardHeader id="onboarding" title="מה קורה אחרי ההזמנה" subtitle="המערכת לא שולחת מייל הזמנה. שלחו לאדם את הקישור ואת ההסבר הזה." />
            <div className="px-5 pb-5 flex flex-col gap-4">
              <ol className="list-decimal ps-5 flex flex-col gap-2 text-sm text-ink-2">
                <li>פותחים את כתובת המערכת ולוחצים על <strong className="text-ink">&quot;קיבלתי הזמנה וזו הפעם הראשונה שלי&quot;</strong>.</li>
                <li>נרשמים עם אותה כתובת דוא״ל שהוזמנה, ובוחרים סיסמה של 12 תווים לפחות.</li>
                <li>מאשרים את הכתובת דרך הקישור שנשלח לדוא״ל.</li>
                <li>נכנסים למערכת ומגדירים אפליקציית אימות בטלפון (למשל Google Authenticator או Microsoft Authenticator). מעכשיו כל כניסה דורשת גם קוד מהאפליקציה.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted-soft px-3 py-2">
                <code className="text-[13px] text-ink flex-1 min-w-0 truncate" dir="ltr">{loginUrl}</code>
                <CopyButton text={loginUrl} label="העתקת הקישור" />
              </div>
              <p className="text-[12px] text-ink-3">ההזמנה נשארת ממתינה עד שהאדם נרשם. אחרי ההרשמה הוא/היא עוברים לרשימת הצוות הפעיל עם התפקיד שבחרתם.</p>
            </div>
          </Card>
        </div>

        <Card aria-labelledby="pending">
          <CardHeader id="pending" title={`הזמנות ממתינות (${invites.length})`} subtitle="אנשים שהוזמנו ועדיין לא נרשמו." />
          {invites.length === 0 ? (
            <EmptyState title="אין הזמנות ממתינות">כדי לצרף אדם לצוות, מלאו את טופס ההזמנה.</EmptyState>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {invites.map((inv) => {
                const scope = scopeText(inv, lookups);
                return (
                  <li key={inv.email} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="font-medium">{inv.full_name}</div>
                      <div className="text-[12px] text-ink-3" dir="ltr" style={{ textAlign: "end" }}>{inv.email}</div>
                      <div className="text-[13px] text-ink-2 mt-0.5">
                        {ROLE_LABELS[inv.role]}{scope && ` · ${scope}`}
                        <span className="text-ink-3"> · הוזמן/ה ב-{formatDate(inv.created_at)}{inv.invited_by && nameOf(inv.invited_by) ? ` על ידי ${nameOf(inv.invited_by)}` : ""}</span>
                      </div>
                    </div>
                    <form action={cancelInvite}>
                      <input type="hidden" name="email" value={inv.email} />
                      <ConfirmSubmit message={`לבטל את ההזמנה של ${inv.full_name}? הכתובת לא תוכל להירשם למערכת.`} variant="secondary">
                        ביטול ההזמנה<span className="sr-only"> של {inv.full_name}</span>
                      </ConfirmSubmit>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {inactive.length > 0 && (
          <Card aria-labelledby="inactive-staff">
            <CardHeader id="inactive-staff" title={`חשבונות מושבתים (${inactive.length})`} subtitle="אין להם גישה למערכת. ההיסטוריה שלהם נשמרת." />
            <StaffTable rows={inactive} lookups={lookups} userId={userId} caption="חשבונות מושבתים" />
          </Card>
        )}

        <Card aria-labelledby="matrix">
          <CardHeader
            id="matrix"
            title="מטריצת הרשאות"
            subtitle="מה כל תפקיד רואה ויכול לעשות. התקנות מחייבות להחזיק רשימה עדכנית של בעלי ההרשאות — אפשר לייצא אותה לקובץ."
            action={<a href="/api/admin/permissions" download className={buttonClass("quiet", "sm")}><Download className="size-4" aria-hidden />ייצוא</a>}
          />
          <PermissionMatrixTable />
        </Card>
      </div>
    </>
  );
}
