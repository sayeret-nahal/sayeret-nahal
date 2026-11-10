import { NextResponse, type NextRequest } from "next/server";
import { getAuthState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Global search. Results are filtered by RLS to what this user may see.
export async function GET(req: NextRequest) {
  const s = await getAuthState();
  if (!s.staff || !s.staff.is_active) return NextResponse.json({ results: [] }, { status: 401 });
  if ((s.requireMfa || s.nextAal === "aal2") && s.aal !== "aal2") return NextResponse.json({ results: [] }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  if (q.trim().length < 2) return NextResponse.json({ results: [] });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_contacts", { p_q: q, p_limit: 8 });
  await supabase.rpc("log_access", { p_action: "search", p_table: "contacts", p_record: null, p_details: { results: data?.length ?? 0 } });
  if (error) return NextResponse.json({ results: [], error: "search_failed" }, { status: 500 });
  const cohorts = await supabase.from("cohorts").select("id,label");
  const label = (id: number | null) => cohorts.data?.find((c) => c.id === id)?.label ?? null;
  return NextResponse.json({
    results: (data ?? []).map((r: { id: string; full_name: string; phone: string | null; cohort_id: number | null; city: string | null }) => ({
      id: r.id, name: r.full_name, phone: r.phone, cohort: label(r.cohort_id), city: r.city,
    })),
  });
}
