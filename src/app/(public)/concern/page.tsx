import type { Metadata } from "next";
import { getPublicSettings } from "../_lib/settings";
import { EmergencyBox, PublicHeading } from "../_lib/ui";
import { ConcernForm } from "./concern-form";

export const metadata: Metadata = { title: "מודאג/ת לגבי חבר?" };

export default async function ConcernPage() {
  const s = await getPublicSettings();
  return (
    <>
      <PublicHeading title="מודאג/ת לגבי חבר?">
        <p>
          אם חבר מהצוות או מהמחזור מתרחק, לא עונה, או שמשהו מרגיש לא בסדר — ספרו לנו.
          אנשי העמותה יבדקו, ויחזרו אליך אם צריך עוד פרטים. לא צריך להיות בטוחים — עדיף לשאול.
        </p>
      </PublicHeading>

      <EmergencyBox text={s.emergency_text} className="mb-5" />

      <ConcernForm privacyText={s.privacy_notice_text} emergencyText={s.emergency_text} />
    </>
  );
}
