import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, LogOut } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { NAV } from "@/components/shell/nav";
import { NavIcon } from "@/components/shell/icons";
import { requireStaff } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/labels";
import { signOut } from "@/app/(auth)/login/actions";

export const metadata: Metadata = { title: "עוד" };

/** Mobile "more" page: everything that is not in the bottom bar, plus the account and sign-out. */
export default async function MorePage() {
  const { staff, email } = await requireStaff();
  const items = NAV.filter((n) => !n.mobile && n.show(staff.role));

  return (
    <>
      <PageHeader title="עוד" />

      <div className="flex flex-col gap-5 max-w-xl">
        <Card aria-label="חשבון">
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand-strong font-semibold shrink-0" aria-hidden>
              {staff.full_name.trim().charAt(0) || "?"}
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{staff.full_name}</div>
              <div className="text-[13px] text-ink-2">{ROLE_LABELS[staff.role]}</div>
              {email && <div className="text-[12px] text-ink-3 truncate" dir="ltr" style={{ textAlign: "end" }}>{email}</div>}
            </div>
          </div>
        </Card>

        {items.length > 0 && (
          <nav aria-label="עמודים נוספים">
            <Card>
              <ul className="divide-y divide-line">
                {items.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href} className="flex items-center gap-3 px-5 min-h-12 py-3 text-sm text-ink hover:bg-canvas">
                      <NavIcon name={it.icon} className="size-5 text-ink-2 shrink-0" />
                      <span className="flex-1">{it.label}</span>
                      <ChevronLeft className="size-4 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </nav>
        )}

        <form action={signOut}>
          <button type="submit" className="w-full flex items-center justify-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface h-12 text-sm text-ink-2 hover:bg-muted-soft hover:text-ink">
            <LogOut className="size-4" aria-hidden />
            יציאה מהמערכת
          </button>
        </form>
        <p className="text-[12px] text-ink-3 text-center -mt-2">במכשיר משותף, תמיד צאו מהמערכת בסיום.</p>
      </div>
    </>
  );
}
