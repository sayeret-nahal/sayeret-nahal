// Row shapes used by the app (kept in sync with supabase/migrations by hand).
export type AppRole = "admin" | "manager" | "coordinator" | "cohort_lead" | "donor_coordinator" | "volunteer";
export type InteractionKind = "call" | "meeting" | "message" | "attempt" | "event" | "note";
export type InteractionOutcome = "talked" | "no_answer" | "rescheduled" | "needs_followup" | "no_contact_requested";
export type CaseKind = "request" | "concern";
export type CaseStatus = "new" | "in_progress" | "waiting" | "resolved";
export type Priority = "normal" | "high" | "urgent";
export type TaskStatus = "open" | "done" | "cancelled";

export interface Staff {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  cohort_scope: number[];
  region_scope: number[];
  phone: string | null;
  is_active: boolean;
}

export interface Lookup {
  id: number;
  label: string;
  sort_key: number;
}

export interface ContactType {
  code: string;
  label: string;
  is_sensitive: boolean;
  sort_key: number;
}

export interface CareStatus {
  code: string;
  label: string;
  cadence_days: number | null;
  severity: number;
  sort_key: number;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string | null;
  phone_status: "unknown" | "valid" | "invalid";
  email: string | null;
  cohort_id: number | null;
  region_id: number | null;
  city: string | null;
  birth_date: string | null;
  owner_id: string | null;
  profession: string | null;
  skills: string[];
  available_to_help: boolean;
  skills_share_consent: boolean;
  campaign_consent: boolean | null;
  notes: string | null;
  source: string;
  verified_at: string | null;
  verified_by: "self" | "staff" | null;
  is_demo: boolean;
  archived_at: string | null;
  merged_into: string | null;
  created_at: string;
  updated_at: string;
  last_paid_at: string | null;
  member_since: string | null;
}

export interface ContactCare {
  contact_id: string;
  status_code: string;
  cadence_days: number | null;
  last_contact_at: string | null;
  next_contact_at: string | null;
  snooze_until: string | null;
}

export interface Interaction {
  id: string;
  contact_id: string;
  staff_id: string | null;
  kind: InteractionKind;
  outcome: InteractionOutcome | null;
  context: "community" | "donor";
  summary: string | null;
  occurred_at: string;
}

export interface Case {
  id: string;
  ref_no: number;
  kind: CaseKind;
  contact_id: string | null;
  subject_name: string | null;
  requester_name: string | null;
  requester_phone: string | null;
  requester_email: string | null;
  preferred_channel: string | null;
  preferred_time: string | null;
  message: string | null;
  source: string;
  category: string | null;
  status: CaseStatus;
  priority: Priority;
  assignee_id: string | null;
  opened_at: string;
  due_at: string;
  last_activity_at: string;
  resolved_at: string | null;
  resolution: string | null;
  created_by: string | null;
  is_demo: boolean;
}

export interface CaseAlert {
  id: string;
  ref_no: number;
  kind: CaseKind;
  priority: Priority;
  status: CaseStatus;
  assignee_id: string | null;
  contact_id: string | null;
  opened_at: string;
  due_at: string;
  last_activity_at: string;
  unassigned: boolean;
  overdue: boolean;
  stalled: boolean;
  closed_without_action: boolean;
}

export interface CaseEvent {
  id: string;
  case_id: string;
  staff_id: string | null;
  kind: "created" | "note" | "call" | "assign" | "status" | "resolved" | "reopened";
  body: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  contact_id: string | null;
  case_id: string | null;
  assignee_id: string | null;
  due_date: string | null;
  priority: Priority;
  status: TaskStatus;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Fallen {
  id: string;
  first_name: string;
  last_name: string;
  cohort_id: number | null;
  death_date: string;
  after_sunset: boolean;
  notes: string | null;
  owner_id: string | null;
  is_demo: boolean;
  rank: string | null;
  sub_unit: string | null;
  residence: string | null;
  burial_place: string | null;
  war_operation: string | null;
  enlistment_text: string | null;
  enlistment_year: number | null;
  source_url: string | null;
  source_note: string | null;
}

export interface OrgEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  cohort_id: number | null;
  region_id: number | null;
  description: string | null;
  is_demo: boolean;
}

export interface Donation {
  id: string;
  contact_id: string;
  amount: number;
  currency: string;
  donated_at: string;
  method: string | null;
  campaign_id: number | null;
  is_recurring: boolean;
  external_ref: string | null;
  notes: string | null;
  is_demo: boolean;
}

export interface Campaign {
  id: number;
  name: string;
  goal_amount: number | null;
  starts_on: string | null;
  ends_on: string | null;
  description: string | null;
}

export interface ContactHealth {
  contact_id: string;
  missing_phone: boolean;
  missing_email: boolean;
  missing_cohort: boolean;
  missing_region: boolean;
  no_owner: boolean;
  phone_invalid: boolean;
  not_verified: boolean;
  unreachable: boolean;
}
