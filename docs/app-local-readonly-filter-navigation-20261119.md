# Installed read-only filter navigation

The installed iOS document retains `form-action 'none'`. Three active GET
submissions previously stayed on the old route with a pending indicator:
monthly/custom period filters in the legacy authorized payroll-tax view and
the Portable report date Load form. Actual-component loopback reproductions
confirmed the CSP failure before this repair.

Only these three forms now carry a private `data-app-local-read-filter` marker.
The installed helper admits an exact marked/current-page pair:

| Marker | Current page and GET destination | Successful control names |
| --- | --- | --- |
| `payroll-tax-period` | `/payroll/tax-company` | report, preset, month, segment, payPeriodStart, start, end |
| `portable-report-date` | `/pos/portable/report` | date |

The helper requires an admitted local route and a scope reader, checks the
declared/effective action, original method, encoding and target, rejects
credentials, fragments, unknown/duplicate controls and unsupported submitters,
and uses the existing Safari-compatible successful-control serializer. HTML
GET query replacement and the Portable form's implicit action are preserved.

The current full route and scope are captured on submit and checked again
before queued navigation. A disconnected form or a changed route/scope releases
only its own pending attempt without navigating. CompactFilters can close its
popover during the original submit; visibility does not become authority.
Existing defaultPrevented, original submit and offline guards still run first.

The existing per-form/attempt/destination acknowledgement releases pending on
success, failure, cleanup and pageshow. Its private event name is retained.
Explore Search serialization and lifecycle remain shared and separately tested.

This changes navigation only. Server context, native admission, permission,
today-only Portable report policy, payroll/tax calculations, money, published
snapshots and Show rules are unchanged. The `source='published-tax'` Owner view
uses its existing controlled read-only filters and receives no marker.

The audit excluded hosted/admin forms and MarketStartupView: installed Market
renders controlled MarketClient inputs. Normal installed workspace selection
uses the existing native `shell.switch-workspace` handoff and fresh admission;
no Workspace/auth/payment form is admitted by this repair. Legacy raw Workspace
forms were not established as an active installed path and remain unchanged.

Verification uses the actual two view components, NavigationForm, CompactFilters,
installed Next navigation adapter, current helper and strict CSP with synthetic
metadata. Only financial/upload/closing views below the tested filters are inert
fixture stubs. Ten focused groups include the three original failures, repeat,
Back, implicit/absolute actions, submitter fallback, duplicate/failure pending,
scope/route cancellation, original guards and seventeen exclusion variants.
The existing fifteen Search and seven retained Help groups run alongside them.

These are local Chromium/source checks. The final release must regenerate its
combined signed native bundle and perform physical iOS acceptance. This change
does not itself publish web/native code, install an app or certify a store build.
