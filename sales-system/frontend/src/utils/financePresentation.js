export const peso = value => value == null || !Number.isFinite(Number(value)) ? "Unconfirmed" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value));
export const confirmedProfitLabel = overview => overview.reconciledStatementCount > 0 ? peso(overview.netProfit) : overview.statementCount > 0 ? "Unconfirmed" : "No Data";
export const financeDate = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "Not available";
export const shopDay = (now = new Date()) => new Date(new Date(now).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
export const validFinanceDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const validFinanceRange = range => validFinanceDate(range.from) && validFinanceDate(range.to) && range.from <= range.to;
export function financePreset(preset, now = new Date()) {
  const to = new Date(`${shopDay(now)}T00:00:00Z`); const from = new Date(to);
  if (preset === "last7") from.setUTCDate(from.getUTCDate() - 6);
  if (preset === "last30") from.setUTCDate(from.getUTCDate() - 29);
  if (preset === "thisMonth") from.setUTCDate(1);
  if (preset === "yesterday") { from.setUTCDate(from.getUTCDate() - 1); to.setUTCDate(to.getUTCDate() - 1); }
  if (preset === "lastMonth") { to.setUTCDate(0); from.setUTCFullYear(to.getUTCFullYear(), to.getUTCMonth(), 1); }
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), preset };
}
export const transactionLabel = type => ({ SETTLE: "Settlement credit", WITHDRAW: "Withdrawal", TRANSFER: "Platform transfer", REVERSE: "Withdrawal reversal" }[type] || "Transaction");
export const reconciliationLabel = state => ({ reconciled: "Reconciled", awaiting_transactions: "Awaiting Settlement Data", awaiting_order: "Awaiting Order Data", awaiting_cost: "Awaiting Capital Cost", awaiting_reconciliation: "Awaiting Reconciliation", ambiguous: "Needs Review", amount_mismatch: "Needs Review", unmatchable: "Needs Review" }[state] || "Unconfirmed");
export const paymentLabel = state => ({ SUCCESS: "Successful", PAID: "Bank payout completed", PROCESSING: "Payment processing", FAILED: "Failed", SETTLED: "Settled in TikTok" }[state] || "Payment not confirmed");
export function reconciliationExplanation(row) {
  if (row.type && row.type !== "SETTLE") return "This ledger movement is not additional sales revenue. Review the corresponding settlement statement for order costs and profit.";
  return ({ reconciled: "Settlement transactions and applicable historical product capital are reconciled. This does not confirm receipt in your bank account.", awaiting_transactions: "TikTok recorded this earnings credit, but a matching statement is not linked. Profit remains unconfirmed until statement transactions are available and matched.", awaiting_order: "Related order data has not been imported. Sync Orders, then Sync Finance.", awaiting_cost: "Historical capital or its allocation is incomplete. Review the related orders and capital costs, then Sync Finance.", awaiting_reconciliation: "Profit cannot be confirmed until settlement transactions and product capital are reconciled.", ambiguous: "More than one statement matches this credit. Review is needed before assigning orders or profit.", amount_mismatch: "Imported transactions do not match TikTok's statement total. Review and synchronize again.", unmatchable: "Automatic matching reached its retry limit. Review missing orders and cost data before trying again." }[row.reconciliationStatus] || "Financial reconciliation is not yet confirmed.");
}
export function syncPresentation(jobs = [], lastSuccessful) {
  const active = jobs.find(job => ["pending", "running"].includes(job.status)); const job = active || jobs[0];
  if (job?.status === "running") return { label: "Syncing", tone: "pending", message: job.stage || "Importing financial records", active: true, job };
  if (job?.status === "pending") return { label: "Waiting to retry", tone: "pending", message: job.stage === "Waiting for previous sync lease" ? "Another synchronization is finishing. This job will retry automatically." : "Synchronization is queued or temporarily delayed. The system will retry automatically.", active: true, job };
  if (job?.status === "failed") return { label: "Failed", tone: "negative", message: job.errorMessage || "Finance synchronization failed. Review the details and retry.", active: false, job };
  return lastSuccessful || job?.status === "completed" ? { label: "Up to date", tone: "positive", message: "Last synchronization completed successfully. New TikTok records may arrive later.", active: false, job } : { label: "Not synchronized", tone: "neutral", message: "Sync Finance to import your shop's financial records.", active: false, job };
}
export function filteredFinanceRows(rows, kind, search = "", sort = "date_desc") {
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(row => !query || [row.transactionId, row.statementId, transactionLabel(row.type), reconciliationLabel(row.reconciliationStatus), paymentLabel(kind === "earnings" ? row.status : row.sourceTotals?.paymentStatus)].filter(Boolean).join(" ").toLowerCase().includes(query));
  const [key, direction] = sort.split("_"); const sign = direction === "asc" ? 1 : -1;
  const value = row => key === "date" ? new Date(kind === "earnings" ? row.transactionDate : row.settlementDate).getTime() : key === "amount" ? BigInt((kind === "earnings" ? row.amountMinor : row.netSettlementMinor) || 0) : key === "profit" ? row.reconciliationStatus === "reconciled" && row.calculatedProfitMinor != null ? BigInt(row.calculatedProfitMinor) : null : key === "orders" ? row.orderCount || 0 : transactionLabel(row.type);
  return filtered.sort((a, b) => { const av = value(a); const bv = value(b); return av == null ? bv == null ? 0 : 1 : bv == null ? -1 : sign * (av < bv ? -1 : av > bv ? 1 : 0) || String(a._id).localeCompare(String(b._id)); });
}
export function financePage(rows, requestedPage, pageSize) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)); const page = Math.max(1, Math.min(requestedPage, pages));
  return { page, pages, rows: rows.slice((page - 1) * pageSize, page * pageSize) };
}
export function financeCsv(rows, kind, range) {
  const headers = kind === "earnings" ? ["Date (Manila)", "Transaction ID", "Transaction", "Amount (PHP)", "Processing status", "Reconciliation", "Selected from", "Selected to"] : ["Date (Manila)", "Statement ID", "Orders", "Settlement revenue (PHP)", "Fees (PHP)", "Tax (PHP)", "Net settlement (PHP)", "Known capital (PHP)", "Confirmed profit (PHP)", "Reconciliation", "Payment status", "Selected from", "Selected to"];
  const data = rows.map(row => kind === "earnings" ? [financeDate(row.transactionDate), row.transactionId, transactionLabel(row.type), row.amount, paymentLabel(row.status), reconciliationLabel(row.reconciliationStatus), range.from, range.to] : [financeDate(row.settlementDate), row.statementId, row.orderCount, row.totalRevenue, row.totalFees, row.totalTaxes, row.netSettlement, row.totalCapitalCost, row.reconciliationStatus === "reconciled" ? row.calculatedProfit ?? "Unconfirmed" : "Unconfirmed", reconciliationLabel(row.reconciliationStatus), paymentLabel(row.sourceTotals?.paymentStatus), range.from, range.to]);
  const cell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers, ...data].map(row => row.map(cell).join(",")).join("\r\n");
}
