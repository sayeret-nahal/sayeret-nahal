"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import { NavIcon } from "./icons";
import type { NavItem } from "./nav";

type Item = Pick<NavItem, "href" | "label" | "icon" | "mobile"> & { badge?: number };

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function SideNav({ items }: { items: Item[] }) {
  const path = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((it) => {
        const active = isActive(path, it.href);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex items-center gap-3 rounded-lg px-3 h-10 text-[15px] transition-colors",
                active
                  ? "bg-white/12 text-white font-semibold before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full before:bg-sun"
                  : "text-white/80 hover:bg-white/8 hover:text-white",
              )}
            >
              <NavIcon name={it.icon} className={cx("size-[18px] shrink-0", active && "text-sun")} />
              <span className="flex-1">{it.label}</span>
              {!!it.badge && (
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-danger text-white text-[11px] font-semibold grid place-items-center tabular-nums">
                  <span aria-hidden>{it.badge > 99 ? "99+" : it.badge}</span>
                  <span className="sr-only">, {it.badge} דורשים טיפול</span>
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function BottomNav({ items }: { items: Item[] }) {
  const path = usePathname();
  const mobile = items.filter((i) => i.mobile);
  return (
    <nav aria-label="ניווט ראשי" className="lg:hidden no-print fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)]">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${mobile.length + 1}, minmax(0, 1fr))` }}>
        {mobile.map((it) => {
          const active = isActive(path, it.href);
          return (
            <li key={it.href}>
              <Link href={it.href} aria-current={active ? "page" : undefined}
                className={cx("relative flex flex-col items-center justify-center gap-0.5 h-14 text-[11px]", active ? "text-brand-strong font-semibold" : "text-ink-3")}>
                <NavIcon name={it.icon} className="size-5" />
                {it.label === "שיחות ומשימות" ? "שיחות" : it.label}
                {!!it.badge && <><span className="absolute top-1.5 start-[calc(50%+6px)] size-2 rounded-full bg-danger" aria-hidden /><span className="sr-only">, {it.badge} דורשים טיפול</span></>}
              </Link>
            </li>
          );
        })}
        <li>
          <Link href="/more" aria-current={path === "/more" ? "page" : undefined}
            className={cx("flex flex-col items-center justify-center gap-0.5 h-14 text-[11px]", path === "/more" ? "text-brand-strong font-medium" : "text-ink-3")}>
            <span aria-hidden className="text-lg leading-5">⋯</span>
            עוד
          </Link>
        </li>
      </ul>
    </nav>
  );
}
