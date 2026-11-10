import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getPublicSettings } from "@/app/(public)/_lib/settings";
import { InquiryForm, type Topic } from "@/app/(public)/contact/inquiry-form";

export const metadata: Metadata = { title: "פנייה לעמותה" };

export default async function EmbedContact({ searchParams }: { searchParams: Promise<{ topic?: string; page?: string }> }) {
  const sp = await searchParams;
  const s = await getPublicSettings();
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_inquiry_topics");
  const topics = (data ?? []) as Topic[];
  return (
    <InquiryForm topics={topics} defaultTopic={topics.some((t) => t.code === sp.topic) ? sp.topic : undefined}
      privacyText={s.privacy_notice_text} orgName={s.org_name ?? "העמותה"} page={sp.page?.slice(0, 300)} />
  );
}
