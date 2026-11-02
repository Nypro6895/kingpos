# Settings design correction — source review of build 85

The user screenshot is the actual Public team child page. It confirms the released child content did not follow the approved compact preview. Passing build/archive/tests established source and behavior checks, not design acceptance. The previous claim that the whole child-page redesign was complete was incorrect.

Reference: `C:/Reylumi/work/salon-settings-compact.html` and `all-settings-compact.html`. Baseline: uploaded build 85, source `6f1e61360a7f7ebf165ce6823bc4566a639e7a82`. This candidate is isolated from production and has not been deployed.

| Area | Source finding | Design status / remaining work |
| --- | --- | --- |
| Salon Settings overview | Seven grouped destinations, retained form state | Navigation implemented; not proof of child-page completion |
| Business info | Compact fields, Address/Description still inline disclosures | Partial. Approved preview has dedicated compact address/description children |
| Public profile / discovery | Existing readiness list, map status/refresh and explanatory content retained | Needs actual per-state visual review and compact row grouping |
| Opening hours | Compact weekly rows; original special-hours form remains in the page | Partial. Special dates should be a separate concise child flow as previewed |
| Public team | Four large bulk buttons, vertically stacked per-staff labels, repeated long descriptions and order inputs | Confirmed mismatch from physical screenshot. Actual editor rewritten in this candidate: compact staff rows, direct Booking/Posting switches, collapsed bulk/order/help, Save only when changed |
| Staff appointments | Original permission switch and explanation | Source preserved; needs visual review against the same row/control rhythm |
| Ownership | Legacy invitation, transfer and leave forms remain in the standalone section | Needs the preview's compact owner list and separate action/review flows; retain all owner safeguards |
| Salon status | Existing backup, pause/reactivate and permanent-close panels with extensive forms | Needs compact action rows and deliberate review children; retain all impact and confirmation requirements |
| All Settings: Profile & contact / Public profile | Shared legacy account/public-profile editors inside the compact shell | Needs actual child screenshots; shell styling does not establish that each editor matches the approved design |
| Login & security / Blocked users | Original security and privacy editors | Needs separate verification of forms, empty/loading/error and device lists; preserve confirmation boundaries |
| Notifications / Connections & invitations / Delete account | Original panels with different internal structures | Needs consistent compact rows and isolated action screens; no weakening of confirmations |
| Salon information / Website & public profile | Shared read/edit sections and legacy profile preferences/media editors | Partial. Card/edit-panel rhythm is not the same as the approved direct-row preview |
| Services & prices / Booking rules | Existing service manager, availability editor and plugin forms | Needs actual loaded-child review, including drawers, staff/service selectors and empty/error states |
| Team & invitations / Payroll | Per-person read/edit sections with nested settings | Needs unified staff list and compact per-person child layouts; preserve financial/access logic |
| POS & devices / Today shortcuts | Existing device, display and shortcut editors | Needs per-section review rather than inheriting shell acceptance |
| Ownership / Salon status in All Settings | Separate implementations from standalone Salon Settings | Must be reviewed alongside standalone equivalents so the same function does not keep two different styles |
| Staff profile / Working hours / Add salon / Legal / Help | Additional destinations listed by settings-navigation.ts | Source inventory only; not visually accepted by the previous release |

## Public team correction verified locally

Actual React editor and compact workspace are rendered by the preview, with synthetic staff and stubbed server responses. Four viewport widths: 320, 375, 430 and 768. Direct switches do not save implicitly. Cancel restores saved data. Server rejection and connection failure preserve drafts; retry sends the existing canonical batch payload. Pending requests disable editing. Inactive-staff and bulk semantics are preserved. Read-only mode cannot submit. No production writes.

`preview/index.html` is a working local review artifact; `preview/public-team-375.png` is its screenshot. It is not an authenticated iOS capture. This task remains working: the other child-page gaps above are not declared complete or release-ready.
