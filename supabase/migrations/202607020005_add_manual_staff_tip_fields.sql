alter table public.pos_ticket_staff_earnings
add column if not exists tip_is_manual boolean not null default false,
add column if not exists manual_tip_amount numeric(12,2);

alter table public.pos_ticket_staff_earnings
drop constraint if exists pos_ticket_staff_earnings_manual_tip_amount_nonnegative;

alter table public.pos_ticket_staff_earnings
add constraint pos_ticket_staff_earnings_manual_tip_amount_nonnegative
check (manual_tip_amount is null or manual_tip_amount >= 0);
