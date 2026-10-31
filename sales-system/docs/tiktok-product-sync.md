# TikTok Shop read-only product synchronization

Phase 2 stores channel snapshots and SKU mappings in `TikTokProductMapping`. It never creates or updates RJE Product records, physical stock, capital costs, selling prices, sales or inventory transactions. Admins can synchronize and manually select existing RJE products; authenticated staff can view snapshots.

## APIs and sources

- Authorized shops: `GET /authorization/202309/shops` — https://partner.tiktokshop.com/docv2/page/get-authorized-shops-202309
- Product search: `POST /product/202502/products/search` — https://partner.tiktokshop.com/docv2/page/search-products-202502
- Product details: `GET /product/202309/products/{product_id}` — https://partner.tiktokshop.com/docv2/page/get-product-202309
- Current official integration index confirming search/detail paths: https://partner.tiktokshop.com/docv2/page/10lt0djm

Version check: bundled official OAS contains Search Products 202309, 202312 and 202502; Get Product 202309; authorized shops 202309. Official current integration guidance confirms search 202502 and detail 202309. No newer equivalent operation was found. Newer edit/create APIs are different capabilities. Some direct docv2 pages require JavaScript; exact schemas were inspected from the bundled OAS.

## Partner Center verification required before live validation

The local implementation does not prove which permissions are enabled on the actual Partner Center application. No authenticated Partner Center session was available during implementation.

1. Open your application in Partner Center and check its API permissions against Required scope on each endpoint above. Product Basic (`seller.product.basic`) is the product permission family; verify the exact read permission shown for Search Products and Get Product for your application/market. Also verify the seller authorization permission required by Get Authorized Shops. Do not request write scopes for this phase.
2. If permissions were added, have the seller reauthorize. Settings displays scopes returned by TikTok; an empty list means unavailable evidence, not confirmed permission denial.
3. In TikTok Settings click Refresh shop information. The integration retains the existing authorized PH shop or selects the sole PH shop. Ambiguous PH shops produce an error rather than silently choosing another shop.
4. Open TikTok Products and click Sync Products. Verify returned SKU count, variations, prices and stock against Seller Center. Map unmatched/duplicate SKUs to existing RJE products with the dropdown.
5. Confirm RJE Product stock, sellingPrice and capitalPrice are unchanged before/after synchronization. Never paste tokens or secrets into support logs.

## Behavior

Search follows next_page_token with repeated-token protection, then retrieves details for products except FREEZE/DELETED (detail API excludes these statuses). SKU IDs and product IDs remain strings. Missing price/stock display Unavailable; stock sums in-stock warehouse quantities, excluding backorders. Prices prefer tax_exclusive_price for local PH sellers and fall back to sale_price when absent. Variations use sales_attributes.

Exact trimmed uppercase SKU matches map automatically only when unambiguous. Duplicate channel SKUs remain unmapped for manual review. Manual mappings, including an intentional unmapping, survive later syncs. Deleting an RJE product is reflected at the next successful reconciliation. No duplicate RJE products can be created because synchronization has no Product write calls.

A MongoDB lease prevents concurrent syncs and a heartbeat renews it. The API retries rate limits/server errors at most four attempts with capped delays, signs each attempt afresh and refreshes expired tokens once. Browser responses never include tokens, secret, shop cipher or upstream error text. Channel authorization failures do not expire the RJE login.

Partial failures retain successfully written SKU snapshots; the last complete sync date advances only after all pages and reconciliation succeed. Historical snapshots absent from a later search are retained, not deleted or assumed to have zero stock. Use each row's Last synchronized date to judge freshness. This is a snapshot view, not a transactionally consistent catalog export.

## Validation

Run `node --test tests/tiktok.test.js` from backend. Tests use mocked HTTP/database calls and fake tokens; no live seller calls or MongoDB writes are made.

Run `npm run build` from frontend. Live seller synchronization and actual Partner Center scope verification remain deployment checks.
