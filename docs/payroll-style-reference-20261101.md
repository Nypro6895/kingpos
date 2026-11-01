# Payroll reference style

> This initial style revision is superseded by [the four-screen reference revision](./payroll-exact-reference-20261101.md). Its older peach preference and screenshot paths are historical.

Owner scope: use the two supplied images as the visual language, while retaining the subsequently agreed financial model. Inspect and align the remaining Payroll sections as well. This is a presentation/navigation revision of the previously shipped Shop money work, based on commit `88246c1`. No database migration, payroll arithmetic, payment write, permission or production data change is included.

| Surface | Finding and adjustment |
| --- | --- |
| Shared navigation | Shop is the default. Remove Overview/Analytics from navigation; keep Staff and Tools. Gift/Reward/Discount have one Gift & Rewards parent and direct local selectors. |
| Shop | Flat reconciliation rows, a prominent estimated available amount, pale green total, fine separators. Desktop separates summary and breakdown into two columns; the daily ledger spans the content width. |
| Staff | Same typography, separators and green earnings totals. Bonus/check inputs use the soft peach form background. Desktop uses two detail columns. Existing pay/payment distinctions remain visible. |
| Tools | Remove isolated rounded card styling. Consistent flat rows on phones and aligned columns on desktop. |
| Payroll Settings | Remove the raised schedule card and shadow; retain a flat section with the shared input/action treatment. No effective-date or compensation rule changes. |
| Tax | Shared surface, headings, action and input styles; connection/report behavior is unchanged. |
| Download | Peach input panel, consistent white fields and peach submit action; existing export filters and current-data retrieval remain intact. |
| Expenses | The shared Shop-money surface also brings its existing Reports panel into the same visual language. No new rent scheduling or expense semantics were invented from the reference image. |

Old Overview/Analytics/aggregate-history links without an exact record resolve to Shop. Exact history links still use the captured Staff/Shop/record context, including original business date and current selected period. Staff-only access still resolves to Staff. Direct reward and discount links remain valid and select their original subsection within the combined parent.

## Evidence

- `artifacts/payroll-style-reference-20261101/regression.log`: 28 money/formula/navigation assertions pass.
- `artifacts/payroll-style-reference-20261101/history-browser.log`: actual web/native page components, exact record/history and original-period checks pass.
- `artifacts/payroll-style-reference-20261101/browser/results.json`: 64 views (eight surfaces, two runtimes, 320/390/768/1440px), no viewport overflow or browser errors; preview financial writes rejected and none attempted.
- `artifacts/payroll-style-reference-20261101/build.log`: production build and offline assets pass with background dispatch disabled.
- Scoped ESLint: zero errors; seven existing unused helper warnings in the two parent page modules.
- Screenshots use actual source components/CSS with sample backend data. The preview salon header is only fixture chrome; it does not replace the production account header. No live verification, release promotion or physical Windows/iPhone acceptance is claimed by these screenshots.

Publication requires integrating the frozen files against the then-current deployed source. Packaged JS/CSS changes require an iOS bundle update under the existing release policy. This revision has not been published by this task.
