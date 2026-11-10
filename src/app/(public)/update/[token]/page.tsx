import type { Metadata } from "next";
import { LinkIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPublicSettings } from "../../_lib/settings";
import { PublicHeading } from "../../_lib/ui";
import { UpdateForm, type UpdateProfile } from "./update-form";

export const metadata: Metadata = {
  title: "עדכון פרטים",
  // the personal token is in the URL: never send it to other sites
  referrer: "no-referrer",
};

export default async function UpdatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  let token = rawToken ?? "";
  try { token = decodeURIComponent(token); } catch { token = ""; }
  const [settings, profile] = await Promise.all([getPublicSettings(), loadProfile(token)]);

  if (profile === "error") {
    return (
      <Message title="לא הצלחנו לטעון את הפרטים">
        <p>כנראה תקלה זמנית אצלנו. נסו לפתוח את הקישור שוב בעוד כמה דקות.</p>
      </Message>
    );
  }
  if (!profile) {
    return (
      <Message title="הקישור הזה כבר לא בתוקף">
        <p>קישורים לעדכון פרטים תקפים לזמן מוגבל, וכשנשלח קישור חדש — הקודם מתבטל.</p>
        <p>אפשר לפנות לעמותה ולבקש קישור חדש. תודה על הסבלנות!</p>
      </Message>
    );
  }

  return (
    <>
      <PublicHeading title={`היי ${profile.first_name},`}>
        <p>אנחנו מעדכנים את פרטי הקהילה — לוקח דקה. בדקו שהפרטים נכונים, תקנו מה שצריך ולחצו &quot;שמירה&quot;.</p>
      </PublicHeading>
      <UpdateForm token={token} profile={profile} privacyText={settings.privacy_notice_text} />
    </>
  );
}

async function loadProfile(token: string): Promise<UpdateProfile | null | "error"> {
  if (!token || token.length > 200) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_update_profile", { p_token: token });
  if (error) return "error";
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  return {
    first_name: s("first_name"),
    last_name: s("last_name"),
    phone: s("phone"),
    email: s("email"),
    city: s("city"),
    region_id: typeof d.region_id === "number" ? d.region_id : null,
    profession: s("profession"),
    skills: Array.isArray(d.skills) ? (d.skills as unknown[]).filter((x): x is string => typeof x === "string") : [],
    available_to_help: d.available_to_help === true,
    skills_share_consent: d.skills_share_consent === true,
    campaign_consent: typeof d.campaign_consent === "boolean" ? d.campaign_consent : null,
    regions: Array.isArray(d.regions)
      ? (d.regions as { id: unknown; label: unknown }[])
          .filter((r) => typeof r?.id === "number" && typeof r?.label === "string")
          .map((r) => ({ id: r.id as number, label: r.label as string }))
      : [],
  };
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface px-5 py-8 text-center shadow-sm">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted-soft text-ink-2" aria-hidden><LinkIcon className="size-5" /></span>
      <h1 className="mt-3 text-xl font-semibold text-ink">{title}</h1>
      <div className="mt-3 text-[15px] text-ink-2 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
