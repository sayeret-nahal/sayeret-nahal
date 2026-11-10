-- A request or concern can only be assigned to someone who is allowed to see it
-- (donor staff have no access to care data, so a case assigned to them would vanish).
create or replace function public.case_assignee_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (select 1 from public.staff s where s.id = new.assignee_id and s.is_active
                     and s.role in ('admin', 'manager', 'coordinator', 'cohort_lead', 'volunteer')) then
    raise exception 'אפשר להקצות פנייה רק לאיש/אשת צוות שמורשה לראות פניות' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger case_assignee_check before insert or update on public.cases
  for each row execute function public.case_assignee_check();
revoke execute on function public.case_assignee_check() from public, anon, authenticated;
