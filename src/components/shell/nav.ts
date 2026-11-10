import type { AppRole } from "@/lib/types";
import { perms } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "users" | "phone" | "inbox" | "calendar" | "heart" | "briefcase" | "chart" | "settings" | "megaphone";
  badgeKey?: "alerts" | "due";
  show: (role: AppRole) => boolean;
  mobile?: boolean;
}

export const NAV: NavItem[] = [
  { href: "/", label: "היום שלי", icon: "home", show: () => true, mobile: true },
  { href: "/contacts", label: "אנשים", icon: "users", show: () => true, mobile: true },
  { href: "/follow-up", label: "שיחות ומשימות", icon: "phone", badgeKey: "due", show: () => true, mobile: true },
  { href: "/cases", label: "פניות", icon: "inbox", badgeKey: "alerts", show: perms.seeCases, mobile: true },
  { href: "/calendar", label: "תאריכים ואירועים", icon: "calendar", show: () => true },
  { href: "/donors", label: "תורמים", icon: "heart", show: perms.manageDonors },
  { href: "/broadcasts", label: "הודעות תפוצה", icon: "megaphone", show: perms.broadcast },
  { href: "/skills", label: "מאגר כישורים", icon: "briefcase", show: () => true },
  { href: "/reports", label: "דוחות", icon: "chart", show: perms.reports },
  { href: "/admin", label: "ניהול", icon: "settings", show: perms.admin },
];
