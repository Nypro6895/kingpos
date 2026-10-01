# User-facing message audit

Scope: customer, personal, owner, staff and Portable messages in app/ and lib/. Copy changes only; no settings, permissions, error codes or transaction logic changed. Existing console diagnostics and error-detection patterns are retained. Legal policy text is excluded.

| Previous wording | Replacement | Locations |
| --- | --- | --- |
| Supabase environment variables are missing. | This feature is temporarily unavailable. Please try again later. | `app/booking-setup/actions.ts` (1); `app/pos/actions.ts` (18); `app/salon-profile/actions.ts` (1); `app/salon-settings/actions.ts` (2); `app/staff/actions.ts` (3); `app/pos/portable/actions.ts` (3); `app/pos/settings/actions.ts` (1); `app/(app)/permissions/page.tsx` (1); `app/(app)/roles/page.tsx` (1); `app/(app)/api/staff/invite/signup/route.ts` (2); `app/(app)/api/auth/forgot-password/route.ts` (1); `app/(app)/api/auth/login/route.ts` (1); `app/(app)/api/auth/signup/route.ts` (1); `lib/account-social.ts` (1); `lib/beauty-salon-publications.ts` (2); `lib/booking-setup.ts` (1); `lib/bookings.ts` (4); `lib/customers.ts` (3); `lib/daily-pos-report.ts` (3); `lib/operational-report.ts` (1); `lib/payroll.ts` (2); `lib/permissions.ts` (2); `lib/pos-desk.ts` (1); `lib/pos-portable-access.ts` (1); `lib/pos-settings.ts` (1); `lib/pos-ticket-staff-earnings.ts` (1); `lib/pos-tickets.ts` (3); `lib/public-booking.ts` (5); `lib/salon-business-hours.ts` (1); `lib/salon-lifecycle.ts` (5); `lib/salon-operating-status.ts` (4); `lib/salon-profile.ts` (18); `lib/salon-settings.ts` (3); `lib/services.ts` (2); `lib/staff-appointments.ts` (1); `lib/staff-salon-connections.ts` (4); `lib/staff-workdays.ts` (5); `lib/staff.ts` (6); `lib/today-dashboard.ts` (1); `lib/today-quick-accesses.ts` (1); `lib/booking-domain/queries.ts` (3) |
| Authentication storage is not configured. | Account security is temporarily unavailable. Please try again later. | `lib/account-security-backoffice.ts` (1); `lib/account-security.ts` (1) |
| Account recovery is not configured. | Account recovery is temporarily unavailable. Please try again later. | `app/account-recovery/actions.ts` (1) |
| Account recovery storage is not ready. Apply the latest database migration and try again. | Account recovery is temporarily unavailable. Please try again later or contact support. | `app/account-recovery/actions.ts` (1) |
| Login security storage is not ready. Apply the latest database migration to save sessions, trusted devices, recovery codes, and recovery requests. | Security settings are temporarily unavailable. Please try again later or contact support. | `lib/account-security.ts` (1) |
| Login security storage is not ready. Apply the latest database migration and try again. | Security settings are temporarily unavailable. Please try again later or contact support. | `app/settings/login-security/actions.ts` (1) |
| Login security storage is not ready. | Security settings are temporarily unavailable. Please try again later. | `app/settings/login-security/actions.ts` (2) |
| Login security back-office storage is not ready. Apply the latest migration. | Recovery support is temporarily unavailable. Please try again later. | `lib/account-security-backoffice.ts` (1) |
| Phone verification is not configured. | Phone verification is temporarily unavailable. Please try again later. | `app/account/actions.ts` (1); `lib/phone-otp.ts` (1) |
| Phone 2FA is not configured in Supabase Auth. | Text-message verification is temporarily unavailable. Please try again later. | `app/settings/login-security/actions.ts` (1) |
| SMS login alerts are not configured in this environment. | Text-message login alerts are temporarily unavailable. | `lib/login-sms-alerts.ts` (1) |
| Authentication is not configured. Please contact support. | Sign-in is temporarily unavailable. Please try again later or contact support. | `app/reset-password/reset-password-form.tsx` (2) |
| Authentication is not configured. | Sign-in is temporarily unavailable. Please try again later. | `app/settings/login-security/actions.ts` (1) |
| Explore search is unavailable because Supabase is not configured. | Salon search is temporarily unavailable. Please try again later. | `lib/explore-search.ts` (1) |
| Explore search is not ready yet. Apply the public discovery migration and try again. | Salon search is temporarily unavailable. Please try again later. | `lib/explore-search.ts` (1) |
| Saved shortcuts are unavailable because Supabase is not configured. | Saved shortcuts are temporarily unavailable. Please try again later. | `lib/today-quick-accesses.ts` (1) |
| Portable POS database setup is not applied yet. Apply the Portable POS access migrations through 202607250001_portable_shell_views.sql before creating POS IDs. | Portable access is temporarily unavailable. Please try again later or contact support. | `lib/pos-portable-access.ts` (1) |
| Portable Ticket data RPC is not applied yet. Apply the Portable ticket migration before enabling this page. | Portable tickets are temporarily unavailable. Please try again later. | `app/pos/portable/actions.ts` (1) |
| Portable Book data RPC is not applied yet. Apply the Portable shell migration before enabling appointment operations. | Portable appointments are temporarily unavailable. Please try again later. | `app/pos/portable/actions.ts` (1) |
| Portable Report data RPC is not applied yet. Apply the Portable shell migration before enabling restricted reports. | Portable reports are temporarily unavailable. Please try again later. | `app/pos/portable/actions.ts` (1) |
| Draft sync needs attention. Check connection, access and database migrations before continuing. | This draft could not be synced. Check your connection and access, then try again. | `app/pos/portable/actions.ts` (1) |
| Offline check-in is not configured. | Offline check-in is unavailable. Connect to the internet to check in. | `app/pos/portable/actions.ts` (1) |
| Ticket corrections are not enabled in the database yet. Please run the latest migration and try again. | Ticket corrections are temporarily unavailable. Please try again later or contact support. | `app/pos-tickets/actions.ts` (1) |
| Staff check-in cannot be enabled until the staff check-in database migration is applied. | Staff check-in is temporarily unavailable. Please try again later or contact support. | `app/pos/settings/actions.ts` (1) |
| Apply the Portable POS access migration before pairing a display. | Display pairing is temporarily unavailable. Please try again later or contact support. | `app/pos/settings/customer-display-install-panel.tsx` (1) |
| Each active line must include one unique parts payload. | Some service details are missing or duplicated. Review the ticket and try again. | `app/pos-tickets/actions.ts` (2) |
| Owner invitation token is required. | This ownership invitation link is incomplete. Please open the full link from your invitation. | `lib/owner-transfer.ts` (1) |
| No server-side geocoding provider is configured. | Map location lookup is temporarily unavailable. Please try again later. | `lib/location/geocoding-service.ts` (1) |
| A server-side geocoding provider is configured; refresh the map location after confirming the address. | Confirm the salon address, then refresh its map location. | `lib/location/salon-map-location.ts` (1) |
| No server-side geocoding provider is configured, so KITY will not create coordinates or map markers. | Map location lookup is temporarily unavailable. Your salon can still be found by city, state, and ZIP. | `lib/location/salon-map-location.ts` (1) |
| Map provider not configured | Map lookup unavailable | `lib/location/salon-map-location.ts` (1) |
| Ready to geocode | Ready to locate | `lib/location/salon-map-location.ts` (1) |
| The last controlled geocoding attempt failed. The salon remains searchable by city, state, and ZIP. | We could not update the map location. Your salon can still be found by city, state, and ZIP. | `lib/location/salon-map-location.ts` (1) |
| This salon has stored coordinates and can participate in real distance sorting. | Your salon is located on the map and can appear in nearby search results. | `lib/location/salon-map-location.ts` (1) |
| The public address changed after coordinates were stored. Existing coordinates are preserved until refreshed. | The salon address has changed. Refresh the map location to update its pin. | `lib/location/salon-map-location.ts` (1) |
| Custom ranges are capped at ${MAX_REPORT_DAYS} days for this MVP. | Choose a date range of up to ${MAX_REPORT_DAYS} days. | `lib/operational-report.ts` (1) |
| Amounts must be valid non-negative currency values. | Enter an amount of 0 or more, with up to 2 decimal places. | `app/reports/daily-closing-form.tsx` (1); `app/pos/portable/report/portable-report-closing-form.tsx` (1) |
| Fix amount fields before saving. | Check the amounts before saving. | `app/pos/portable/report/portable-report-closing-form.tsx` (1) |
| SMS login alerts are enabled in settings, but the app SMS sender               is not configured in this environment. | Text-message login alerts are turned on, but messages cannot be sent right now. Please try again later. | `app/settings/login-security/login-security-panel.tsx` (1) |

| Experience capture is ready in the app; the reputation backend still needs to be enabled. | Sharing your experience is temporarily unavailable. Please try again later. | `app/activity/actions.ts` (1) |
| Supabase Auth phone OTP is configured for transactional phone verification. | Phone verification is available. | `lib/phone-otp.ts` (1) |
| No transactional phone OTP provider is configured in this workspace. | Phone verification is temporarily unavailable. Please try again later. | `lib/phone-otp.ts` (1) |
| Booking metrics require booking.view permission. | You do not have access to appointment statistics. Ask a salon owner if you need access. | `lib/operational-report.ts` (1) |
| New and returning customer metrics require customers.view permission. | You do not have access to customer statistics. Ask a salon owner if you need access. | `lib/operational-report.ts` (1) |
| Staff performance is using POS item assignment fallback because staff earning rows were not available for this range. | Staff performance is based on assigned ticket items because earnings records are unavailable for these dates. | `lib/operational-report.ts` (1) |
| Large result sets may be truncated by the current report limit. | This report may not include every record. Choose a shorter date range to see more detail. | `lib/operational-report.ts` (1) |

## Verification scope

This inventory covers the literal messages replaced in this pass. Some integrations return dynamic error text; those paths require separate runtime verification and are not claimed to be exhaustively sanitized here. Developer logs, internal identifiers, SQL files and legal policy wording are not customer-copy replacements.
