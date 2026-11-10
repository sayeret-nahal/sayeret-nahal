import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { CampaignDialog } from "@/components/donors/dialogs";
import { DonorsTabs, GoalProgress } from "@/components/donors/parts";
import { fetchAll } from "@/components/donors/queries";
import { requireStaff } from "@/lib/auth";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, relativeDay, todayIL } from "@/lib/dates";
import type { Campaign } from "@/lib/types";

export const metadata: Metadata = { title: "קמפיינים" };

type Lite = { campaign_id: number; contact_id: string; amount: number; currency: string };

export default async function CampaignsPage() {
  const { staff } = await requireStaff();
  if (!perms.manageDonors(staff.role)) redirect("/");
  const supabase = await createClient();
  const today = todayIL();

  const [campaignsRes, donations] = await Promise.all([
    supabase.from("campaigns").select("*").returns<Campaign[]>(),
    fetchAll<Lite>((a, b) =>
      supabase.from("donations").select("campaign_id,contact_id,amount,currency").not("campaign_id", "is", null).order("id").range(a, b)),
  ]);

  const stats = new Map<number, { raised: number; count: number; donors: Set<string> }>();
  for (const d of donations.rows) {
    const s = stats.get(d.campaign_id) ?? { raised: 0, count: 0, donors: new Set<string>() };
    if (d.currency === "ILS") s.raised += Number(d.amount);
    s.count++;
    s.donors.add(d.contact_id);
    stats.set(d.campaign_id, s);
  }

  const phase = (c: Campaign): "active" | "upcoming" | "ended" | "open" =>
    c.starts_on && c.starts_on > today ? "upcoming" : c.ends_on && c.ends_on < today ? "ended" : c.starts_on || c.ends_on ? "active" : "open";
  const order = { active: 0, open: 1, upcoming: 2, ended: 3 } as const;
  const campaigns = [...(campaignsRes.data ?? [])].sort((a, b) =>
    order[phase(a)] - order[phase(b)] || (b.starts_on ?? "").localeCompare(a.starts_on ?? "") || a.name.localeCompare(b.name, "he"));

  return (
    <>
      <PageHeader
        title="קמפיינים"
        description="גיוסים ממוקדים עם יעד ותאריכים. כל תרומה שמשויכת לקמפיין נספרת כאן."
        actions={<CampaignDialog />}
      />
      <DonorsTabs current="/donors/campaigns" />

      {(campaignsRes.error || donations.error) && <p role="alert" className="text-sm text-danger mb-3">טעינת הקמפיינים נכשלה. רעננו את הדף.</p>}

      {campaigns.length === 0 ? (
        <Card>
          <EmptyState title="עדיין אין קמפיינים" action={<CampaignDialog />}>
            יוצרים קמפיין עם שם, יעד ותאריכים, ואז משייכים אליו תרומות (ידנית או בייבוא). ההתקדמות לעבר היעד תוצג כאן.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {campaigns.map((c) => {
            const s = stats.get(c.id);
            const p = phase(c);
            const goal = c.goal_amount != null ? Number(c.goal_amount) : null;
            return (
              <li key={c.id}>
                <Card className="h-full flex flex-col">
                  <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[15px] font-semibold text-ink">{c.name}</h2>
                        {p === "active" && <Badge tone="ok">פעיל</Badge>}
                        {p === "upcoming" && <Badge tone="info">טרם התחיל</Badge>}
                        {p === "ended" && <Badge>הסתיים</Badge>}
                      </div>
                      <p className="text-[13px] text-ink-3 mt-0.5">
                        {c.starts_on || c.ends_on
                          ? <>
                              {c.starts_on ? formatDate(c.starts_on) : "…"} – {c.ends_on ? formatDate(c.ends_on) : "ללא תאריך סיום"}
                              {p === "active" && c.ends_on ? ` · מסתיים ${relativeDay(c.ends_on)}` : ""}
                              {p === "upcoming" && c.starts_on ? ` · מתחיל ${relativeDay(c.starts_on)}` : ""}
                            </>
                          : "ללא תאריכים"}
                      </p>
                    </div>
                    <CampaignDialog campaign={c} />
                  </div>
                  {c.description && <p className="px-5 text-sm text-ink-2 whitespace-pre-line line-clamp-3">{c.description}</p>}
                  <div className="px-5 pt-4 pb-4 mt-auto">
                    <GoalProgress raised={s?.raised ?? 0} goal={goal} label={`התקדמות הקמפיין ${c.name}`} />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-3">
                      <span>
                        {s ? `${s.count.toLocaleString("he-IL")} תרומות מ-${s.donors.size.toLocaleString("he-IL")} תורמים` : "עדיין אין תרומות משויכות"}
                      </span>
                      {s && <Link href={`/donors/donations?campaign=${c.id}`} className="text-brand hover:underline">לתרומות בקמפיין</Link>}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
