import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getTikTokPricing } from "../services/tiktokService.js";
import "./PricingDrawer.css";

const money = value => value == null ? "Not available" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value));
export default function PricingDrawer({ row, onClose }) {
  const [form, setForm] = useState({ targetMargin: String(row.pricing?.targetMargin ?? row.pricing?.preferences?.pricingTargetMargin ?? 25), useManual: row.pricing?.source === "manual_assumption", deductionRate: String(row.pricing?.preferences?.pricingDeductionRate ?? ""), fixedCharge: "0", discountPercent: "0", discountFixed: "0" });
  const [result, setResult] = useState(row.pricing); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  const root = useRef(null); const close = useRef(null); const action = useRef(onClose); action.current = onClose;
  useEffect(() => {
    const previous = document.activeElement; close.current?.focus(); document.body.classList.add("dialog-open");
    const key = event => {
      if (event.key === "Escape") action.current();
      if (event.key !== "Tab") return;
      const controls = [...root.current.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled])")];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.classList.remove("dialog-open"); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    const timer = setTimeout(() => {
      const options = { targetMargin: form.targetMargin, useManual: String(form.useManual), ...(form.useManual ? { deductionRate: form.deductionRate, fixedCharge: form.fixedCharge, discountPercent: form.discountPercent, discountFixed: form.discountFixed } : {}) };
      getTikTokPricing(row._id, options).then(value => { if (active) setResult(value); }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [row._id, form, retry]);
  const edit = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const input = (key, label, max) => <label>{label}<input type="number" inputMode="decimal" min="0" max={max} step="0.01" value={form[key]} onChange={event => edit(key, event.target.value)}/></label>;
  const ready = !loading && !error && result?.status === "ready";
  return <div className="pc-drawer-layer" onMouseDown={event => event.target === event.currentTarget && onClose()}><aside className="pc-drawer pricing-drawer" ref={root} role="dialog" aria-modal="true" aria-labelledby="pricing-title"><header><div><p className="eyebrow">Advisory pricing · never published automatically</p><h2 id="pricing-title">Suggested TikTok Price</h2><p>{row.title} · {row.sellerSku || row.tiktokSkuId}</p><small>{row.variations?.map(item => `${item.name}: ${item.value}`).join(" · ") || "Default variant"}</small></div><button ref={close} type="button" className="pc-icon-button" aria-label="Close pricing breakdown" onClick={onClose}><X size={20}/></button></header>
    <div className="pc-drawer-body">
      <section><h3>Actual recorded data</h3><dl>{[["Current TikTok price", row.currency === "PHP" ? money(row.price) : `${row.currency || "Unknown currency"} ${row.price ?? "Not available"}`], ["Current capital per unit (PHP)", row.capitalCost == null ? "Set Capital Cost" : money(row.capitalCost)], ["Confirmed historical margin", row.settlementProfitMargin == null ? "Unconfirmed" : `${row.settlementProfitMargin.toFixed(2)}%`], ["Eligible settled orders sampled", result?.history?.sampleCount ?? 0], ["Eligible settled units", result?.history?.settledUnits ?? 0], ["Historical average original item price", money(result?.history?.averageOriginalPrice)], ["Historical actual settlement / unit", money(result?.history?.averageSettlement)], ["Historical effective all-in deductions", result?.history?.effectiveDeductionPercent == null ? "Insufficient Settlement Data" : `${result.history.effectiveDeductionPercent.toFixed(2)}% of original item prices`]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="pricing-help">Confirmed margin uses historical costs and settlements; it is not the expected margin at today's listed price. Samples use only attributable, reconciled orders for this variant.</p></section>
      <section className="pricing-assumptions"><h3>Projection inputs</h3>{input("targetMargin", "Target settlement profit margin (%)", "99.99")}<p className="pricing-help">Saved minimum: {result?.preferences?.pricingMinimumMargin ?? 20}%. Recommendations must be strictly above it. Operating expenses: {money(result?.preferences?.pricingOperatingExpense ?? 0)} per unit.</p><label className="pricing-checkbox"><input type="checkbox" checked={form.useManual} onChange={event => edit("useManual", event.target.checked)}/>Use manually assumed deductions and promotions</label>{form.useManual && <div className="pricing-input-grid">{input("deductionRate", "Assumed deduction rate (%)", "99.99")}{input("fixedCharge", "Fixed charge per unit (PHP)")}{input("discountPercent", "Planned seller discount (%)", "99.99")}{input("discountFixed", "Additional seller discount per unit (PHP)")}</div>}<p className="pricing-help">Manual deductions apply to the price after seller discounts. Fixed charges apply afterward. Include shipping or other fixed deductions once. Changing inputs here does not save shop preferences.</p></section>
      {loading ? <p role="status">Calculating advisory price…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry pricing calculation</button></div> : !ready ? <p className="pricing-warning" role="status">{result?.message || "Pricing unavailable"}</p> : <section className="pricing-projection" aria-label="Projected pricing breakdown"><h3>Estimated outcome — not confirmed profit</h3><p>{result.source === "manual_assumption" ? "Manual assumption" : "Historical percentage-plus-fixed estimate"}</p><dl>{[["Suggested selling price", money(result.suggestedPrice)], ["Difference from current price", result.differenceFromCurrent == null ? "Not available" : `${Number(result.differenceFromCurrent) >= 0 ? "+" : ""}${money(result.differenceFromCurrent)}`], ["Modeled percentage deduction", `${result.deductionPercent.toFixed(4)}%`], ["Modeled fixed charge / unit", money(result.fixedCharge)], ["Operating expenses / unit", money(result.operatingExpense)], ["Estimated settlement / unit", money(result.estimatedSettlement)], ["Estimated profit / unit", money(result.estimatedProfit)], ["Estimated settlement profit margin", `${result.estimatedMargin.toFixed(2)}%`], ["Estimated margin at current price", result.currentProjection?.margin == null ? "Not available" : `${result.currentProjection.margin.toFixed(2)}%`], ["Round upward by", money(result.roundingIncrement)]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="pricing-help">{result.formula}</p><p className="pricing-help">Margin = (estimated settlement − capital − operating expenses) ÷ estimated settlement. At zero fixed charges and discounts: price = (capital + expenses) ÷ [(1 − deductions) × (1 − target margin)].</p></section>}
      {!loading && !error && <div className="pricing-warning">{result?.warnings?.map(warning => <p key={warning}>{warning}</p>)}{result?.history?.reason && !result.warnings?.includes(result.history.reason) && <p>{result.history.reason}</p>}<p>Recommendations are advisory. Review current TikTok fees and promotions before manually updating a listing. No prices, historical costs or financial records are changed by this calculator.</p></div>}
    </div></aside></div>;
}
