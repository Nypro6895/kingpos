// Synthetic data only. No credentials, customer records, database or provider calls.
export function ticketDetailFixture(search = '') {
  const query = new URLSearchParams(search);
  const scenario = query.get('scenario') || 'closed';
  const long = scenario === 'long' || query.has('long');
  const now = '2026-11-14T07:25:00.000Z';
  const salonId = '11111111-1111-4111-8111-111111111111';
  const ticketId = '22222222-2222-4222-8222-222222222222';
  const customerId = '33333333-3333-4333-8333-333333333333';
  const staffId = '44444444-4444-4444-8444-444444444444';
  const bookingId = '55555555-5555-4555-8555-555555555555';
  const serviceNames = ['Express Pedicure', 'Full Set', 'Ombre'];
  const amounts = [25, 40, 15];
  const durations = [25, 45, 15];
  const services = serviceNames.map((name, index) => ({
    id: `66666666-6666-4666-8666-66666666666${index}`,
    salon_id: salonId, name, category: 'Nails', base_price: amounts[index],
    duration_minutes: durations[index], description: null, is_active: true,
    online_booking_enabled: true, created_at: now, updated_at: now,
  }));
  const staff = [{
    id: staffId, salon_id: salonId, display_name: long ? 'Kim Nguyen With A Very Long Technician Name' : 'Kim',
    job_title: 'Nail technician', is_active: true, today_status: 'working',
  }];
  staff.push({...staff[0],id:'44444444-4444-4444-8444-444444444445',display_name:'Anna'});
  staff.push({...staff[0],id:'44444444-4444-4444-8444-444444444446',display_name:'Mia'});
  const salon = {
    id: salonId, name: long ? 'King Nails Spa LLC With A Very Long Salon Name' : 'King Nails Spa LLC',
    phone: '(555) 010-0078', country: 'US', city: 'Milwaukee', state: 'WI',
    address_line1: '100 Sample Street', address_line2: null, postal_code: '53202',
    latitude: null, longitude: null, status: 'active', created_at: now, updated_at: now,
    time_zone: 'America/Chicago', timezone: 'America/Chicago',
  };
  const open = ['open', 'unpaid', 'partial', 'empty'].includes(scenario);
  const status = open ? 'open' : scenario === 'voided' ? 'voided' : scenario === 'cancelled' ? 'cancelled' : 'closed';
  const ticket = {
    id: ticketId, salon_id: salonId, source_booking_id: bookingId,
    ticket_number: 'T00078', ticket_sequence: 78, customer_id: customerId,
    opened_at: now, closed_at: open ? null : now, status,
    discount_type: 'fixed_amount', discount_value: scenario === 'money' ? 8 : 0,
    tax_rate: scenario === 'money' ? 10 : 0,
    tip_type: 'fixed_amount', tip_value: scenario === 'money' ? 12.5 : 0,
    notes: 'Synthetic component QA ticket', created_at: now, updated_at: now,
    workspace_revision: 7,
    customer: { id: customerId, name: long ? 'Nene Alexandra Nguyen With A Very Long Customer Name' : 'Nene', phone: '(555) 010-0078', email: 'nene@example.test' },
    source_booking: { id: bookingId, start_at: '2026-11-14T16:00:00.000Z', end_at: '2026-11-14T17:25:00.000Z', status: 'completed' },
    ticket_items: scenario === 'empty' ? [] : services.map((service, index) => ({
      id: `77777777-7777-4777-8777-77777777777${index}`,
      salon_id: salonId, pos_ticket_id: ticketId, service_id: service.id,
      assigned_staff_id: scenario==='editable'?staff[index].id:staffId, performed_by_staff_id: scenario==='editable'?staff[index].id:staffId,
      source_booking_id: bookingId, source_booking_line_id: `88888888-8888-4888-8888-88888888888${index}`,
      source_kind: 'booking', service_name_snapshot: long ? service.name + ' With A Very Long Historical Service Name' : service.name,
      service_category_snapshot: 'Nails', booked_unit_price_snapshot: amounts[index],
      quantity: 1, unit_price: amounts[index], line_total: amounts[index], notes: null,
      created_at: now, updated_at: now, assigned_staff: scenario==='editable'?staff[index]:staff[0], performed_staff: scenario==='editable'?staff[index]:staff[0],
      service: scenario === 'snapshot' ? { ...service, name: 'Renamed current catalog service' } : service,
      turn_parts: [{ id: `part-${index}`, amount: amounts[index], turn_index: 1, turn_type: 'large', staff_id: staffId }],
    })),
    payments: ['unpaid', 'empty'].includes(scenario) ? [] : [{
      id: '99999999-9999-4999-8999-999999999999', salon_id: salonId, ticket_id: ticketId,
      payment_method: 'other', amount: scenario === 'partial' ? 30 : scenario === 'money' ? 91.7 : 80,
      note: 'Synthetic record-only payment; no provider connected.', created_by: null, created_at: now,
    }],
    staff_earnings: [{staff_id:staffId,manual_tip_amount:null,tip_amount:scenario === 'money' ? 12.5 : 0,tip_is_manual:false}],
    audit_logs: [{id:'audit-created',action:'ticket_created_from_booking',note:'Synthetic appointment handoff',created_at:now,created_by_user:{id:'qa-owner',display_name:'QA Owner',email:'owner@example.test'}}],
    adjustments: [],
  };
  if (query.has('gift')) ticket.financial_sources={giftSales:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',last4:'4321',amountCents:2500,status:'completed',paymentMethod:'cash',createdAt:now}],giftRedeemedCents:0,rewardDiscount:0};
  if (query.has('reward')) {
    ticket.discount_value=5;
    ticket.payments[0].amount=75;
    ticket.financial_sources={...(ticket.financial_sources??{giftSales:[],giftRedeemedCents:0}),rewardDiscount:5};
  }
  return { scenario, language:query.get('lang') || 'en', ticket, services, staff, salon,
    isOwner:query.get('role')!=='manager',
    canView:scenario !== 'no-access', canManage:!['view-only','no-access'].includes(scenario),
    canVoid:!['view-only','no-access'].includes(scenario), locked:query.has('locked'),
  };
}
