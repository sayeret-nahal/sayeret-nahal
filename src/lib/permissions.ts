import type { AppRole } from "./types";

// UI-level mirror of the database rules (RLS is the real enforcement; this only hides
// controls a role cannot use, so nobody sees buttons that would fail).
const can = (...roles: AppRole[]) => (role: AppRole) => roles.includes(role);

export const perms = {
  seeCare: can("admin", "manager", "coordinator", "cohort_lead", "volunteer"),
  seeCases: can("admin", "manager", "coordinator", "cohort_lead", "volunteer"),
  seeAllCases: can("admin", "manager", "coordinator"),
  editContacts: can("admin", "manager", "coordinator", "cohort_lead", "donor_coordinator"),
  createContacts: can("admin", "manager", "coordinator", "cohort_lead", "donor_coordinator"),
  bulkEdit: can("admin", "manager", "coordinator"),
  manageDonors: can("admin", "manager", "donor_coordinator"),
  importData: can("admin", "manager", "coordinator", "donor_coordinator"),
  mergeContacts: can("admin", "manager"),
  reviewDuplicates: can("admin", "manager", "coordinator"),
  exportData: can("admin", "manager"),
  reports: can("admin", "manager", "coordinator", "donor_coordinator"),
  manageMemorials: can("admin", "manager", "coordinator"),
  manageEvents: can("admin", "manager", "coordinator", "cohort_lead", "donor_coordinator"),
  broadcast: can("admin", "manager", "coordinator", "donor_coordinator"),
  sendBroadcast: can("admin", "manager"),
  admin: can("admin"),
};
