import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('reorganized Booking retains every persisted field, including collapsed options',()=>{
 const source=readFileSync('app/settings/salon-settings-panels.tsx','utf8');
 const booking=source.slice(source.indexOf('export function BookingSettingsPanel'));
 for(const name of ['minimum_lead_time_minutes','maximum_advance_window_days','slot_interval_minutes','default_cleanup_buffer_minutes','cancellation_window_minutes','timezone_iana','ticket_creation_mode','confirmation_mode'])assert.match(booking,new RegExp(`name="${name}"`));
 for(const name of ['booking_enabled','online_booking_visible','guest_booking_enabled','same_day_booking_enabled','auto_assign_enabled','any_professional_enabled','split_staff_appointment_enabled','reminder_enabled','confirmation_email_enabled'])assert.match(source,new RegExp(`\\["${name}"`));
 assert.doesNotMatch(source,/\["confirmation_sms_enabled"/);
 const sms=readFileSync('app/market/booksms-panel.tsx','utf8');
 for(const name of ['confirmation','reminders'])assert.match(sms,new RegExp(`name="${name}"`));
 assert.match(booking,/bookingChecks.slice\(0,4\)/);assert.match(booking,/bookingChecks.slice\(4,7\)/);assert.match(booking,/bookingChecks.slice\(7\)/);
});
test('Settings no longer loads or embeds system administration integrations',()=>{
 const loader=readFileSync('app/settings/settings-hub-actions.ts','utf8');
 const hub=readFileSync('app/settings/settings-hub-client.tsx','utf8');
 assert.doesNotMatch(loader,/getTwilioSettings|currentUserCanAccessRecoveryBackOffice/);
 assert.doesNotMatch(hub,/TwilioSettingsForm|index.support|index.twilio/);
 assert.match(hub,/href="\/account-recovery"/);
});
test('Booking staff link retains explicit salon target when embedded',()=>{
 const source=readFileSync('app/booking-setup/booking-setup-editors.tsx','utf8');
 assert.match(source,/expectedSalonId \? `\/settings\?section=salon-\$\{encodeURIComponent\(expectedSalonId\)\}-services` : "\/services"/);
});
