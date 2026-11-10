# Earnings product listing audit

The finance drawer mapped every populated order line to its name and joined the names with commas. It discarded SKU identity and quantity in presentation. Distinct TikTok line IDs for the same variant therefore appeared as repeated names, even when they represented legitimate units.

Order sync replaces the normalized lines array using `$set`; it does not append lines on each sync. Orders have a unique shop/order index. Settlement sync deduplicates transaction IDs and upserts by shop/transaction. Detail controllers populate one linked order per transaction; there is no product unwind or join multiplication. Multiple transactions for an order remain separate ledger entries. Existing reconciliation refuses to allocate the same statement-level SKU costs across multiple ambiguous order transactions.

An additional ingestion gap was found: repeated explicit line IDs within one order response were not checked. `uniqueOrderLines` now removes identical repeats, preserves different IDs and missing IDs, and rejects conflicting records for the same ID. Historical cost allocation applies the same protection when reading stored order lines. No automatic database cleanup or financial rewrite is performed.

The drawer now groups by product ID and SKU ID within each original order, preserving all distinct purchased lines and quantities. Missing SKU identities remain separate. It shows variant count, units, expandable names/variants, original line IDs, and unit/item prices when available and consistent. Quantities are explicitly labeled as original purchases, not refund/partial-settlement quantities. Different prices do not become a fabricated uniform price. Styles use existing theme variables and wrapping; the drawer focus trap includes expandable summaries.

Settlement amounts, refund policy, fees and profit formulas are unchanged. Only proven repeated line IDs are excluded from cost inputs. Distinct purchased quantities and historical snapshots are preserved. Previously saved financial totals are not rewritten; authoritative order/finance resynchronization is needed to reconcile any affected persisted data.

Validation: backend suite passed (216 tests), including MongoDB integration scenarios for repeated API pages, repeated syncs, multiple order transactions, refunds, returns and partial/historical cost allocation; frontend production build passed. Added focused tests cover original quantities, separate line identities, variant separation, repeated/conflicting API line IDs, unknown identity, differing prices and original-order display across ledger movements.

Limitation: no live TikTok API or production MongoDB records were inspected. The specific MAKOTO orders still require reconciliation by order ID, SKU ID, line ID and quantity against their authoritative TikTok records. No live visual browser verification was performed.
