import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "סיסמה חדשה" };

export default async function ResetPage() {
  const s = await getAuthState();
  if (!s.user) redirect("/login?error=confirm");
  return <ResetForm />;
}
