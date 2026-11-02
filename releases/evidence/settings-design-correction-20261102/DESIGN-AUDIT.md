# Settings design correction — completed local implementation

The user's Public team screenshot correctly showed that build 85 did not match the agreed compact child-page design. The earlier whole-design completion claim was incorrect. This revision implements the correction across both Settings entry points and their shared editors.

Source: d6b080b2b21a5ddcc9bf65403749acd6ddc14672. This revision has not been deployed. [Review the real-component screenshot gallery](gallery.html).

## Final presentation

- Salon Settings: seven grouped destinations; Address, Description, publishing requirements, current opening status, special dates, owner invite/transfer/leave, backup, pause/reactivation and permanent-close review open as child screens. Web and installed-app form helpers remain in parity.
- Public team: compact staff rows, direct Booking/Posting switches, secondary order/bulk/help disclosures and staged Save/Cancel.
- All Settings: common child navigation around each retained editor, compact fields and right-side switches. Person-specific Staff/Payroll pages; grouped POS/device settings; dedicated security/recovery pages; isolated account-deletion review and owner safeguards. Personal profile, public profile, notifications, connections, Add salon, shortcuts, legal and support share the same row/control rhythm. Staff's own schedule uses the existing compact availability editor.
- Services inside Settings: one concise row with price/duration/staff summary, separate Active and Online controls, retained detailed editor, and a separate create view. The ordinary Services route keeps its existing layout.
- Child navigation preserves original form association and mounted drafts. Invalid hidden required fields open their correct child. Save actions and status/retry messages stay with their owning form/plugin; unrelated Save bars remain hidden. Security outside this Settings navigation retains its original section presentation.

## Local visual coverage

91 screenshots from actual product components with synthetic DTOs and inert transport; 364 view checks at 320, 375, 430 and 768px. Traversal records and screenshots are in coverage.json and pages/. These are browser fixtures, not authenticated or physical iPhone screenshots.

| Actual fixture/editor | Captured views at 375px |
| --- | ---: |
| Salon Settings | 18 |
| Staff working hours | 3 |
| Salon information | 6 |
| Public profile | 8 |
| Booking | 5 |
| Staff & team | 7 |
| Payroll | 3 |
| POS & display | 6 |
| Ownership | 5 |
| Salon status | 3 |
| Website appearance | 3 |
| Login & security | 9 |
| Notifications | 1 |
| Connections | 2 |
| Blocked users | 1 |
| Create salon | 1 |
| Personal profile | 1 |
| Personal public profile | 1 |
| Delete account | 4 |
| Shortcuts | 1 |
| Services & prices | 3 |

Legal/Help use their actual link rows in the hub; per-role staff workspace uses the shared public-profile and availability editors. Those contextual routes have source/shared-component coverage, not a separate authenticated session claim. Map tiles, provider OTP, payment/provider acceptance and physical POS devices are outside these fixtures.

## Validation

- 15 regression cases passed with no skips: browser Back and draft retention, original hidden payloads/required consent/validation, role restrictions, Public team bulk/inactive semantics, rejected and disconnected saves/retry, hours edits/time-off conflicts, owner/closure actions, and retained-reader identity boundaries.
- Personal profile cancellation, email authorization flow, security sections, public avatar flow and unblock fixture passed. All provider actions were inert.
- Whole-editor traversal passed with no runtime exceptions or horizontal document overflow. It also checks switch size/position, correct save ownership, lazy verification, compact Services, no navigation writes, real nested profile save failure/retry, canonical salon payload retention, per-staff Payroll target/version/effective-date payload, and Booking Rules' own Save.
- Full production build including TypeScript passed. Scoped ESLint has zero errors and one unchanged hook dependency warning in services-manager.tsx:562.
- Local iOS JS/CSS bundle generated and source/package integrity verified at this exact source; 87/87 ordinary eligible routes bundled, zero missing. Swift archive/sign/upload and physical-device QA were not run.

## Integration boundary

Implementation is complete locally and frozen for integration. No web deployment or TestFlight upload was performed. Build 85 remains the earlier published UI until the next authorized combined release. Integrate the source-scope.json files against the then-current production/native baselines, rebuild the web and native bundle, and perform authenticated/device review before claiming live or iPhone acceptance. Generated native assets in this worktree are validation outputs; regenerate them from the assembled release source rather than copying an old bundle.
