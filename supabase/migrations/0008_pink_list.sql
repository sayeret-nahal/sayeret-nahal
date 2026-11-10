-- 0008: "הרשימה הורודה" — people who used the association's discounts or community services
-- but are not active paying members. Membership in the list is a contact type ('pink'); whether the
-- person is an active payer is derived from donations, so someone who starts paying drops off by itself.

insert into public.contact_types (code, label, is_sensitive, sort_key)
values ('pink', 'הרשימה הורודה', false, 65)
on conflict (code) do nothing;

-- how far back a payment still counts as "active" (months; editable by an admin in settings)
insert into public.settings (key, value) values ('active_payer_months', '12')
on conflict (key) do nothing;

-- Last payment date, kept on the contact so every role that may see the person can see whether they
-- pay, without seeing donation amounts (donations themselves stay restricted to donor roles).
alter table public.contacts add column last_paid_at date;

create or replace function public.sync_last_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  ids := array_remove(array[
    case when tg_op in ('INSERT', 'UPDATE') then new.contact_id end,
    case when tg_op in ('UPDATE', 'DELETE') then old.contact_id end], null);
  update public.contacts c
     set last_paid_at = (select max(d.donated_at) from public.donations d where d.contact_id = c.id)
   where c.id = any(ids);
  return null;
end $$;
revoke execute on function public.sync_last_paid() from public, anon, authenticated;

create trigger donations_sync_last_paid
  after insert or update of contact_id, donated_at or delete on public.donations
  for each row execute function public.sync_last_paid();

update public.contacts c
   set last_paid_at = d.last
  from (select contact_id, max(donated_at) last from public.donations group by contact_id) d
 where d.contact_id = c.id;
