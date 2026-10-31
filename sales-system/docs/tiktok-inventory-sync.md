# TikTok variant catalog and stock

TikTok Shop listings and variants are the active product catalog. A variant is identified by `shopId + tiktokProductId + tiktokSkuId`; seller SKU text is descriptive and is never the unique identity.

Product synchronization updates listing title, seller SKU, price, status, variations, TikTok stock, and last-sync time. It never overwrites local capital cost and never writes stock back to TikTok. Order imports do not deduct a second local stock quantity.

Capital costs are stored as integer centavos with effective-dated history. New orders snapshot the cost effective on the order date. Existing snapshots remain unchanged. Orders with no applicable history remain unreconciled until an administrator enters an explicit audited historical cost.

Legacy `Product`, inventory, manual-sale, and inventory-movement records are preserved for history. The migration archives local products instead of deleting them. Legacy manual sales continue using their historical local inventory behavior and are not connected to TikTok stock.

## Migration

From `backend/`, preview the migration without writing:

```powershell
node scripts/migrateTikTokVariantCatalog.js
```

Review `transferable`, `conflicts`, and `missing`. Apply only after review:

```powershell
node scripts/migrateTikTokVariantCatalog.js --apply
```

The migration is repeatable. It transfers cost only for a verified one-to-one legacy mapping, does not replace an existing variant cost, creates migration history, and archives local products without deleting records.
