# Customer Activity / History Audit

## Canonical identity and links

- Auth identity is resolved server-side from Supabase auth to `public.users.id` via `users.auth_user_id = auth.uid()` and the existing `public.current_public_user_id()` helper.
- Application code uses `getCurrentKingUser()` and `createAuthenticatedSupabaseServerClient()` for authenticated customer reads.
- Salon customer ownership for Activity uses the explicit verified link `customers.customer_user_id = public.users.id`.
- Activity does not authorize by browser-provided customer IDs, phone numbers, email addresses, customer lookup text, or customer-display draft payloads.

## Canonical POS sources

- Purchase ownership: `pos_tickets.customer_id -> customers.id`, with `customers.customer_user_id = current_public_user_id()`.
- Purchase inclusion: completed POS purchases only, `pos_tickets.status = 'closed'`.
- Purchase lines: `pos_ticket_items` filtered to `is_removed = false`, using `service_name_snapshot` first, then `services.name` as fallback.
- Purchase staff display: `pos_ticket_items.performed_by_staff_id` or `assigned_staff_id -> staff.display_name`.
- Purchase totals: existing `calculateTicketTotals()` from ticket discount, tax, tip, item line totals, and `pos_payments.amount`.
- Customer-safe receipt data excludes POS audit logs, adjustments, staff earnings, turn parts, payroll/commission, internal notes, raw processor data, and POS workflow actions.

## Canonical booking sources

- Booking ownership: `bookings.customer_user_id = public.users.id`.
- Booking salon customer relation remains `bookings.customer_id -> customers.id`.
- Booking service display comes from `booking_lines.service_name_snapshot`, ordered by `booking_lines.display_order`.
- Booking staff display comes from `booking_lines.assigned_staff_id -> staff.display_name` and the booking-level `bookings.staff_id` fallback.
- Booking status uses the existing `BookingStatus` model and normalizes legacy `scheduled` to `confirmed`; customer activity maps future active bookings to `upcoming`, terminal statuses to `completed`, `cancelled`, or `no_show`.
- Booking detail navigation remains the existing personal `/my-bookings/[bookingId]` experience.

## RLS and read model

- Existing booking RLS already permits customer reads through `bookings.customer_user_id = current_public_user_id()`.
- Existing POS RLS is salon-member scoped and does not permit personal customers to read raw POS tables.
- The Activity implementation adds narrow `security definer` RPCs:
  - `get_customer_activity(integer)`
  - `get_customer_activity_receipt(uuid)`
- These RPCs verify the current public user inside the database and return only customer-facing DTO payloads.
- No standalone activity, visited salon, receipt, booking, or copied salon business table was added.

## Runtime audit

- Local app Supabase project ref: `bowkoiprvqwjilwaxhda`.
- Initial failure reproduced through PostgREST as `PGRST202`: `Could not find the function public.get_customer_activity(p_limit) in the schema cache`.
- `202608100001_customer_activity_history.sql` was present locally and missing remotely; it has been applied to the linked dev project.
- `202608100002_customer_activity_history_permissions.sql` tightens default function grants so `authenticated` can execute the Activity RPCs and `anon`/`public` cannot.
- Rollback-only ownership QA showed each signed-in actor sees only their own linked booking and closed POS ticket; cross-owner receipt lookups return `not_found`.
