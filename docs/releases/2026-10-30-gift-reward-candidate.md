# Gift, Reward and Portable release candidate

Owner authorized commit, push and combined web, Windows Portable and iOS release, excluding Market. This candidate implements the subsequent direct decision: buying Gift purchases future value and is excluded from the current invoice discount and tip base.

Service $50, ordinary discount 10%, tip $9 and Gift purchase $100 produce amount due $154. The canonical service receipt retains $50 service, $5 discount and $9 tip. A separate server-owned `gift_card_sale` source records the $100 future value. Gift-only uses the existing Submit action and creates no service ticket, staff turn, labour income or Reward service spend. Counter payment facts remain record-only; this implementation does not claim a card processor charged money. Stripe is the separate online purchase path.

Gift issuance and a linked service receipt commit or roll back together. Retries retain one sale. Voiding an unused linked receipt revokes its issued value once through the existing owner ticket operation. An unused standalone sale has an owner-only void in Gift history. Used value requires reconciliation; no external refund is claimed. Source history is retained.

Reward is included once in canonical invoice discount. Gift redemption retains separate typed ledger facts and unchanged canonical payment rows. Service reconciliation subtracts only the Gift-funded service portion, preserving authoritative Staff/day gross income, tips and closing inputs. Gift-funded tips and purchases never enter the service cash equation. Source reports expose funding and redemption separately.

The frozen Portable presentation task is integrated without its unrelated checkout changes. It preserves layout, improves receipt labels and adds direct Windows settings actions and signed-out fullscreen controls. Windows 0.7.4 uses the existing Online distribution channel. Installer dependency closure and package source are verified before publication. Earlier package attempts with incomplete linked dependencies are excluded.

Validation evidence is under `artifacts/gift-sale-integration-20261030/`: actual isolated SQL and owner void/retry/rollback, actual Next personal/Owner checkout and mixed/Gift-only sale, native account/Portable HTTP transport boundaries, actual Electron presentation, updater unit tests and production build. Synthetic tests do not prove physical device, printer or real Stripe acceptance.

Publication, hosted migration and Apple availability are pending until exact-source live receipts are written. Native baseline is actually uploaded iOS 1.0.0 (74), source 9f2244340a0d47737021ac40abea738fed4e2f6c. New bundled UI and declared API commands require a fresh native build. Universal Links signing remains deferred; no signing ownership/capabilities are changed. Market changes are excluded.
