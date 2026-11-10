import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ContactForm } from "@/components/contacts/contact-form";
import { requireStaff } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { perms } from "@/lib/permissions";

export const metadata: Metadata = { title: "אדם חדש" };

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const { staff } = await requireStaff();
  if (!perms.createContacts(staff.role)) redirect("/contacts");
  const lookups = await getLookups();
  const { name } = await searchParams;
  return (
    <>
      <PageHeader title="הוספת אדם" back={{ href: "/contacts", label: "אנשים" }}
        description="שדה חובה אחד בלבד: שם פרטי. כל השאר אפשר להשלים אחר כך." />
      <ContactForm lookups={{ cohorts: lookups.cohorts, regions: lookups.regions, types: lookups.types, statuses: lookups.statuses, staff: lookups.staff }} canSeeCare={perms.seeCare(staff.role)} defaultName={name} />
    </>
  );
}
