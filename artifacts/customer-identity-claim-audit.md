# Customer Identity Claim Audit

## Existing Identity Model Reused

- Supabase Auth maps to `public.users` through `users.auth_user_id = auth.uid()` and `public.current_public_user_id()`.
- App server code uses `getCurrentKingUser()` and `createAuthenticatedSupabaseServerClient()` for authenticated user scope.
- Customer Activity already uses the canonical ownership relationship `customers.customer_user_id = current public.users.id`.
- Activity RPCs (`get_customer_activity`, `get_customer_activity_receipt`) join POS history through `pos_tickets.customer_id -> customers.id` and do not authorize by phone.

## Customer And POS Flow

- Salon customer records live in `public.customers` with `customer_user_id`, `phone`, `email`, status, notes, and salon `location_id`.
- POS desk checkout creates or finds a salon customer, creates a `pos_tickets` row, inserts line items/payments, closes the ticket, writes an audit log, recalculates staff earnings, and broadcasts POS updates.
- The claim integration is post-close and best-effort. It does not change ticket totals, payment rows, turn parts, staff earnings, payroll, tax, or daily log behavior.

## Phone Handling

- Existing phone normalization was mixed: `normalizeBookingPhone()` stores digits or a leading `+`, while POS live-draft lookup compares digit-only values in SQL.
- Claim ownership uses a new canonical identity normalizer in TypeScript and SQL. US 10-digit numbers normalize to E.164-style `+1...`; stored legacy phone values are compared by the database canonicalizer.
- Phone remains a discovery/proof signal only. Activity authorization remains `customers.customer_user_id`.

## Booking Implications

- Bookings already support `bookings.customer_user_id`, with claim metadata and a `claim_guest_booking_by_manage_token()` RPC.
- This implementation preserves booking logic and does not broaden booking reconciliation. A future follow-up could reuse verified phone ownership to reconcile unowned booking rows, but POS/customer history was the requested scope.

## Account Deletion And OTP

- Local code does not contain a full 30-day pending deletion workflow. It only has `users.status`, with `deleted` treated as a denied final state.
- The migration preserves customer links for non-final statuses and releases customer ownership plus verified-phone ownership when `users.status` changes to `deleted`.
- The OTP boundary now delegates transactional delivery and code verification to Supabase Auth phone OTP. Customer-claim code does not send SMS directly and does not contain vendor-specific SMS credentials.
- Local send attempts only initiate Supabase Auth phone verification. Verified-phone ownership is recorded only after Supabase Auth confirms the code and `auth.users.phone_confirmed_at` matches the requested normalized phone.
- Resend cooldowns, attempt limits, expiry, and verification locks are stored in `customer_phone_otp_challenges`. Already verified phones return without sending another OTP.

## Database Boundary Added

- `customer_claim_tokens`: hashed, short-lived, single-use QR claim tokens.
- `customer_verified_phones`: one active verified owner per normalized phone.
- `customer_phone_otp_challenges`: local cooldown/attempt state for transactional phone verification; it stores no OTP code.
- `customer_account_claims`: lightweight claim audit metadata.
- Customer claim metadata columns on `customers`.
- RPCs for issuing QR tokens, previewing claims, claiming by token, inspecting profile phone claim state, challenging/verifying phone OTP state, recording Auth-confirmed verified phones, and claiming customers for already verified phones.
- Triggers prevent customer ownership reassignment, auto-link future unclaimed customers for verified phones, and release links on final deletion.

## Required Provider Settings

- App env: `REYLUMI_PHONE_OTP_PROVIDER=supabase-auth`.
- Supabase Auth SMS must be configured separately, either with local `[auth.sms.test_otp]` values or a supported transactional SMS provider in `supabase/config.toml` / hosted Auth settings.
- Phone confirmation must remain enabled for the chosen Auth SMS flow; this implementation does not treat a client assertion or profile phone field as verification.
