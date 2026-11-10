import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { getPublicSettings } from "../_lib/settings";
import { EmergencyBox, PublicHeading } from "../_lib/ui";
import { TalkForm } from "./talk-form";

export const metadata: Metadata = { title: "אני צריך/ה לדבר עם מישהו" };

export default async function TalkPage() {
  const s = await getPublicSettings();
  return (
    <>
      <PublicHeading title="אני צריך/ה לדבר עם מישהו">
        <p>אנחנו כאן. השאירו שם וטלפון, ומישהו מהעמותה יחזור אליכם. לא צריך להסביר כלום.</p>
      </PublicHeading>

      <EmergencyBox text={s.emergency_text} className="mb-3" />

      {s.talk_response_text && (
        <p className="flex items-start gap-2 text-sm text-ink-2 mb-5 px-1">
          <Clock className="size-4 shrink-0 mt-0.5 text-brand" aria-hidden />
          {s.talk_response_text}
        </p>
      )}

      <TalkForm responseText={s.talk_response_text} privacyText={s.privacy_notice_text} emergencyText={s.emergency_text} />
    </>
  );
}
