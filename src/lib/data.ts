import { cache } from "react";
import { createClient } from "./supabase/server";
import type { CareStatus, ContactType, Lookup, Staff } from "./types";

/** Reference data used across pages (fetched once per request). */
export const getLookups = cache(async () => {
  const supabase = await createClient();
  const [cohorts, regions, types, statuses, staff] = await Promise.all([
    supabase.from("cohorts").select("*").order("sort_key").order("label").returns<Lookup[]>(),
    supabase.from("regions").select("*").order("sort_key").returns<Lookup[]>(),
    supabase.from("contact_types").select("*").order("sort_key").returns<ContactType[]>(),
    supabase.from("care_statuses").select("*").order("sort_key").returns<CareStatus[]>(),
    supabase.from("staff").select("*").eq("is_active", true).order("full_name").returns<Staff[]>(),
  ]);
  const cohortList = cohorts.data ?? [];
  const regionList = regions.data ?? [];
  const typeList = types.data ?? [];
  const statusList = statuses.data ?? [];
  const staffList = staff.data ?? [];
  return {
    cohorts: cohortList,
    regions: regionList,
    types: typeList,
    statuses: statusList,
    staff: staffList,
    cohortLabel: (id: number | null | undefined) => cohortList.find((c) => c.id === id)?.label ?? "",
    regionLabel: (id: number | null | undefined) => regionList.find((r) => r.id === id)?.label ?? "",
    typeLabel: (code: string) => typeList.find((t) => t.code === code)?.label ?? code,
    status: (code: string | null | undefined) => statusList.find((s) => s.code === code),
    staffName: (id: string | null | undefined) => staffList.find((s) => s.id === id)?.full_name ?? "",
  };
});

export type Lookups = Awaited<ReturnType<typeof getLookups>>;

/** Log a read / export for the access log required by the data-security regulations. */
export async function logAccess(action: "view" | "export" | "report" | "login", table?: string | null, record?: string | null, details?: object): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_access", { p_action: action, p_table: table ?? null, p_record: record ?? null, p_details: details ?? null });
  return !error;
}

export async function hasDemoData(): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true }).eq("is_demo", true);
  return (count ?? 0) > 0;
}
