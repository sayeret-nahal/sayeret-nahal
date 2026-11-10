import Image from "next/image";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hasDemoData } from "@/lib/data";
import { todayIL } from "@/lib/dates";
import { perms } from "@/lib/permissions";
import { ATTENTION_FILTER } from "@/lib/alerts";
import { ROLE_LABELS } from "@/lib/labels";
import { NAV } from "@/components/shell/nav";
import { BottomNav, SideNav } from "@/components/shell/nav-links";
import { GlobalSearch } from "@/components/shell/global-search";
import { IdleLogout } from "@/components/shell/idle-logout";
import { signOut } from "../(auth)/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, userId } = await requireStaff();
  const supabase = await createClient();
  const today = todayIL();

  const [alerts, dueCalls, dueTasks, idle, demo] = await Promise.all([
    perms.seeCases(staff.role)
      ? supabase.from("case_alerts").select("id", { count: "exact", head: true }).neq("status", "resolved").or(ATTENTION_FILTER)
      : Promise.resolve({ count: 0 }),
    perms.seeCare(staff.role)
      ? supabase.from("contact_care").select("contact_id, contacts!inner(owner_id, archived_at)", { count: "exact", head: true })
          .lte("next_contact_at", today).eq("contacts.owner_id", userId).is("contacts.archived_at", null)
      : Promise.resolve({ count: 0 }),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("assignee_id", userId).eq("status", "open").lte("due_date", today),
    supabase.from("settings").select("value").eq("key", "idle_timeout_minutes").maybeSingle<{ value: number }>(),
    hasDemoData(),
  ]);

  const badges = { alerts: alerts.count ?? 0, due: (dueCalls.count ?? 0) + (dueTasks.count ?? 0) };
  const items = NAV.filter((n) => n.show(staff.role)).map(({ href, label, icon, mobile, badgeKey }) => ({
    href, label, icon, mobile, badge: badgeKey ? badges[badgeKey] : undefined,
  }));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 bg-surface px-3 py-2 rounded-lg">דילוג לתוכן</a>

      <aside className="hidden lg:flex no-print flex-col bg-olive-dark text-white sticky top-0 h-dvh">
        <Link href="/" className="flex flex-col items-center gap-1.5 px-5 pt-6 pb-5 border-b border-white/10" aria-label="עמותת סיירת נח״ל · דף הבית">
          <Image src="/brand/logo-on-dark.png" alt="" width={168} height={110} priority className="h-auto w-[148px]" />
          <span className="text-[12px] text-sage/90 tracking-wide">קשר עם הקהילה</span>
        </Link>
        <nav aria-label="ניווט ראשי" className="flex-1 overflow-y-auto p-3"><SideNav items={items} /></nav>
        <div className="border-t border-white/10 p-3">
          <div className="px-2 pb-2">
            <div className="text-sm font-semibold truncate">{staff.full_name}</div>
            <div className="text-[12px] text-sage/90">{ROLE_LABELS[staff.role]}</div>
          </div>
          <form action={signOut}>
            <button className="w-full flex items-center gap-2 rounded-lg px-2 h-9 text-sm text-white/85 hover:bg-white/10 hover:text-white">
              <LogOut className="size-4" aria-hidden /> יציאה
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex flex-col">
        <header className="no-print sticky top-0 z-20 bg-canvas/90 backdrop-blur border-b border-line">
          <div className="flex items-center gap-3 px-4 lg:px-8 h-16">
            <Link href="/" className="lg:hidden grid h-10 w-14 place-items-center rounded-lg bg-olive-dark shrink-0" aria-label="דף הבית">
              <Image src="/brand/emblem.png" alt="" width={46} height={22} className="h-auto w-[46px]" />
            </Link>
            <GlobalSearch />
          </div>
          {demo && (
            <div className="bg-warn-soft text-warn text-[13px] px-4 lg:px-8 py-1.5 border-t border-warn/15">
              המערכת מכילה כרגע <strong>נתוני דוגמה</strong> (מסומנים בתגית &quot;דוגמה&quot;). הם אינם אנשים אמיתיים, ויש למחוק אותם לפני העלאת מידע אמיתי.
            </div>
          )}
        </header>
        <main id="main" className="flex-1 px-4 lg:px-8 py-6 pb-24 lg:pb-10 max-w-[1280px] w-full">{children}</main>
      </div>

      <BottomNav items={items} />
      <IdleLogout minutes={Number(idle.data?.value ?? 30)} />
    </div>
  );
}
