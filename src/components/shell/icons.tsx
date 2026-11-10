import { BarChart3, Briefcase, CalendarDays, HandHeart, Home, Inbox, Megaphone, PhoneCall, Settings, Users } from "lucide-react";
import type { NavItem } from "./nav";

const MAP = { home: Home, users: Users, phone: PhoneCall, inbox: Inbox, calendar: CalendarDays, heart: HandHeart, briefcase: Briefcase, chart: BarChart3, settings: Settings, megaphone: Megaphone };

export function NavIcon({ name, className }: { name: NavItem["icon"]; className?: string }) {
  const Icon = MAP[name];
  return <Icon className={className} aria-hidden strokeWidth={1.8} />;
}
