alter table public.pos_financial_correction_requests
drop constraint if exists pos_financial_correction_requests_correction_type_check;

alter table public.pos_financial_correction_requests
add constraint pos_financial_correction_requests_correction_type_check check (
  correction_type in (
    'cash_amount',
    'credit_card_amount',
    'other_amount',
    'note',
    'ticket_amount',
    'ticket_correction',
    'ticket_service',
    'ticket_tip',
    'ticket_discount',
    'ticket_staff_assignment',
    'staff_service_amount',
    'staff_tip',
    'staff_turn_count',
    'void_ticket',
    'other'
  )
);
