import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { demoLoginEnabled } from "./actions";

export const metadata: Metadata = { title: "כניסה" };

const NOTICES: Record<string, string> = {
  idle: "התנתקת אוטומטית אחרי זמן ללא פעילות, כדי להגן על המידע.",
  not_staff: "החשבון הזה אינו פעיל במערכת. פנו למנהל/ת המערכת.",
  confirm: "לא הצלחנו לאמת את הקישור. נסו להתחבר או לבקש קישור חדש.",
  demo: "הכניסה המהירה לא הצליחה. הפעילו מחדש את הסביבה המקומית (npm run local).",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; reason?: string }> }) {
  const sp = await searchParams;
  return <LoginForm next={sp.next} notice={NOTICES[sp.error ?? sp.reason ?? ""]} demo={await demoLoginEnabled()} />;
}
