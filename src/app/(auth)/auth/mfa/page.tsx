import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth";
import { MfaFlow } from "./mfa-flow";

export const metadata: Metadata = { title: "אימות דו-שלבי" };

export default async function MfaPage() {
  const s = await getAuthState();
  if (!s.user) redirect("/login");
  if (s.aal === "aal2") redirect("/");
  return <MfaFlow />;
}
