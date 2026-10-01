# Owner to Windows synchronization — 2026-09-25

## Observed cause

The latest Owner receipt had committed on the shared database approximately eight seconds after its occurrence timestamp. At diagnosis, the Owner development server was listening on port 3000, but no process was listening on port 3107, the configured origin of the Windows test app. Thus receiving server updates was unavailable even with Wi-Fi connected. This observation does not establish why the previous preview process stopped.

The preview server was rebuilt and started as a separate hidden background process, with logs in work/pos-preview.stdout.log and work/pos-preview.stderr.log. This is a local test server, not an installed Windows service; it is not configured to start automatically after a Windows reboot.

## Repairs

- Connectivity indicator verifies application server reachability, not just navigator.onLine. This probe verifies the application endpoint, not full database health.
- Successful Owner receipt replay additionally publishes the existing pos/staff notification for older clients. Database broadcasts remain primary; writes and idempotency are unchanged.
- Ticket change notifications reconcile dependent staff, report, waiting and booking resources without refreshing the page.
- Today's Portable Ticket view follows the salon business date after midnight. Explicit historical filters remain fixed. Date input follows refreshed data.
- Ticket reads reconcile on focus/pageshow and allow twenty seconds for slower responses; cached data remains available on failure.
- Default server ticket date uses the salon timezone.

## Validation

Four browser regression tests passed: Owner offline outbox/reopen/idempotency, inline amounts and adjustments, live Ticket day rollover/historical filters/focus recovery, and targeted staff updates preserving local work. Added a server-unavailable/Wi-Fi-online assertion. TypeScript, targeted lint and production build passed.

Real isolated-account integration launched the Electron desktop application with a separate test profile and Portable session. A new Owner ticket appeared in the already-open Windows Ticket view without navigation/reload in 828 ms after server acknowledgement. Concurrent duplicate receipt requests committed only one ticket. Integration fixtures were removed after completion.

Existing user tickets and local pending operations were not reset, deleted or resubmitted. An already-open app needs one normal reopen to load the updated client code.
