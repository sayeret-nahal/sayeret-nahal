import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ContactForm } from "@/components/contacts/contact-form";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/types";

export const metadata: Metadata = { title: "עריכת פרטים" };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staff } = await requireStaff();
  if (!perms.editContacts(staff.role)) redirect(`/contacts/${id}`);
  const supabase = await createClient();
  const [{ data: contact }, { data: links }, lookups] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", id).maybeSingle<Contact>(),
    supabase.from("contact_type_links").select("type_code").eq("contact_id", id),
    getLookups(),
  ]);
  if (!contact) notFound();
  return (
    <>
      <PageHeader title={`עריכת פרטים · ${contact.full_name}`} back={{ href: `/contacts/${id}`, label: contact.full_name }} />
      <ContactForm contact={contact} typeCodes={(links ?? []).map((l) => l.type_code as string)} lookups={{ cohorts: lookups.cohorts, regions: lookups.regions, types: lookups.types, statuses: lookups.statuses, staff: lookups.staff }} canSeeCare={perms.seeCare(staff.role)} />
    </>
  );
}
