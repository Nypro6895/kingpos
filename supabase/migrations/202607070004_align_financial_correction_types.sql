update public.pos_financial_correction_requests
set correction_type = case correction_type
  when 'service_amount' then 'staff_service_amount'
  when 'tip' then 'staff_tip'
  when 'turn_count' then 'staff_turn_count'
  when 'staff_assignment' then 'ticket_staff_assignment'
  when 'discount' then 'ticket_discount'
  else correction_type
end
where correction_type in (
  'service_amount',
  'tip',
  'turn_count',
  'staff_assignment',
  'discount'
);

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
