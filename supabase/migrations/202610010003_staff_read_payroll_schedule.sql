-- Active staff may read the salon-wide calendar used by their own payroll.
-- This does not grant write access or access to another salon's settings.
drop policy if exists payroll_staff_read_salon_schedule on public.salon_payroll_settings;
create policy payroll_staff_read_salon_schedule on public.salon_payroll_settings
for select to authenticated
using (public.current_user_staff_id_for_salon(salon_id) is not null);
notify pgrst, 'reload schema';
