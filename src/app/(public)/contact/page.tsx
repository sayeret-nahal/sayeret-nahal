import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getPublicSettings } from "../_lib/settings";
import { EmergencyBox, PublicHeading } from "../_lib/ui";
import { InquiryForm, type Topic } from "./inquiry-form";

export const metadata: Metadata = { title: "פנייה לעמותה" };

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const sp = await searchParams;
  const s = await getPublicSettings();
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_inquiry_topics");
  const topics = (data ?? []) as Topic[];
  return (
    <>
      <PublicHeading title="פנייה לעמותה">
        <p>רווחה, פצועים, אירועים וקהילה, תעסוקה ועוד — כתבו לנו, והפנייה תגיע ישירות לאחראי/ת על התחום.</p>
      </PublicHeading>
      <EmergencyBox text={s.emergency_text} className="mb-4" />
      <InquiryForm topics={topics} defaultTopic={topics.some((t) => t.code === sp.topic) ? sp.topic : undefined}
        privacyText={s.privacy_notice_text} orgName={s.org_name ?? "העמותה"} />
    </>
  );
}
