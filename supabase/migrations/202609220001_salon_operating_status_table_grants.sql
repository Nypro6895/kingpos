revoke all on table public.salon_operating_hours from anon;
revoke all on table public.salon_special_hours from anon;

grant select on table public.salon_operating_hours to anon;
grant select on table public.salon_special_hours to anon;

grant select, insert, update, delete
on table public.salon_operating_hours
to authenticated;

grant select, insert, update, delete
on table public.salon_special_hours
to authenticated;
