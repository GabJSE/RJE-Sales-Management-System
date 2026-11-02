// Integer cents and exact rational arithmetic throughout; Numbers are display-only.
const gcd = (a, b) => b ? gcd(b, a % b) : a < 0n ? -a : a;
export const fraction = (n, d = 1n) => { n = BigInt(n); d = BigInt(d); if (!d) throw Error("Zero denominator"); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
const add = (a,b) => fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const sub = (a,b) => fraction(a.n*b.d-b.n*a.d,a.d*b.d);
const mul = (a,b) => fraction(a.n*b.n,a.d*b.d);
const div = (a,b) => fraction(a.n*b.d,a.d*b.n);
const compare = (a,b) => a.n*b.d-b.n*a.d;
const ceil = a => a.n >= 0n ? (a.n+a.d-1n)/a.d : a.n/a.d;
const floor = a => a.n >= 0n ? a.n/a.d : -((-a.n+a.d-1n)/a.d);
const abs = a => fraction(a.n < 0n ? -a.n : a.n,a.d);
export const decimalMinor = value => {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(?:\.\d{1,2})?$/.test(String(value)) || Number(value) > 1000000000) throw Error("Use a nonnegative amount with at most two decimals, up to 1,000,000,000.");
  const [whole, decimals=""] = String(value).split("."); return BigInt(whole)*100n+BigInt(decimals.padEnd(2,"0"));
};
export const minorDecimal = cents => { const value=BigInt(cents); const sign=value<0n?"-":""; const abs=value<0n?-value:value; return `${sign}${abs/100n}.${String(abs%100n).padStart(2,"0")}`; };
const percent = value => Number(value.n*1000000n/value.d)/10000;
const money = value => minorDecimal(floor(value));
export const pricingDefaults = { pricingMinimumMargin: 20, pricingTargetMargin: 25, pricingDeductionRate: null, pricingRoundingIncrement: 0.01, pricingOperatingExpense: 0 };
export const pricingFields = Object.keys(pricingDefaults);
export function pricingSettings(settings = {}) { return Object.fromEntries(pricingFields.map(key=>[key,settings[key] ?? pricingDefaults[key]])); }
export function validatePricingSettings(data) {
  const errors={};
  for(const key of pricingFields) {
    if(data[key]===undefined || key==="pricingDeductionRate" && data[key]===null) continue;
    try { const value=decimalMinor(data[key]);
      if(key==="pricingMinimumMargin" && (value<2000n || value>9900n)) throw Error("Minimum margin must be between 20% and 99%.");
      if(key==="pricingTargetMargin" && (value<2000n || value>=10000n)) throw Error("Target margin must be at least 20% and below 100%.");
      if(key==="pricingDeductionRate" && value>=10000n) throw Error("Deduction rate must be below 100%.");
      if(key==="pricingRoundingIncrement" && value<1n) throw Error("Rounding increment must be at least 0.01.");
    } catch(error) { errors[key]=error.message; }
  }
  if(!errors.pricingTargetMargin && data.pricingTargetMargin!==undefined && data.pricingMinimumMargin!==undefined && Number(data.pricingTargetMargin)<Number(data.pricingMinimumMargin)) errors.pricingTargetMargin="Target margin cannot be below the minimum margin.";
  return errors;
}

export function fitPricingHistory(samples) {
  const valid = samples.filter(row => row.grossMinor>0n && row.settlementMinor>0n && row.settlementMinor<=row.grossMinor && row.units>0n);
  const summary={ sampleCount:valid.length, settledUnits:valid.reduce((sum,row)=>sum+Number(row.units),0) };
  if(valid.length) {
    const gross=valid.reduce((sum,row)=>sum+row.grossMinor,0n); const settlement=valid.reduce((sum,row)=>sum+row.settlementMinor,0n); const units=valid.reduce((sum,row)=>sum+row.units,0n);
    Object.assign(summary,{ averageOriginalPrice:money(fraction(gross,units)), averageSettlement:money(fraction(settlement,units)), effectiveDeductionPercent:percent(fraction(gross-settlement,gross)) });
  }
  if(valid.length<3) return { ...summary, reason:"At least three eligible reconciled single-unit orders are required; mixed variants and ambiguous adjustments are excluded." };
  const points=valid.map(row=>({x:fraction(row.grossMinor,row.units),y:fraction(row.settlementMinor,row.units)})).sort((a,b)=>compare(a.x,b.x)<0n?-1:compare(a.x,b.x)>0n?1:0);
  const low=points[0],high=points.at(-1);
  if(compare(low.x,high.x)===0n) return {...summary,reason:"Different historical prices are required to distinguish percentage deductions from fixed charges."};
  const spread=sub(high.x,low.x),minimumSpread=compare(div(low.x,fraction(20)),fraction(100))>0n?div(low.x,fraction(20)):fraction(100);
  if(compare(spread,minimumSpread)<0n)return {...summary,reason:"Historical price variation is too small to distinguish fixed charges from rounding noise (requires at least PHP 1 and 5% price spread)."};
  const retention=div(sub(high.y,low.y),sub(high.x,low.x));
  const fixed=sub(mul(retention,low.x),low.y);
  if(retention.n<=0n || compare(retention,fraction(1))>0n || fixed.n<0n) return {...summary,reason:"Historical prices imply subsidies or an unstable deduction model."};
  // One cent per unit permits source rounding, not changing promotions/nonlinear fees.
  if(points.some(point=>compare(abs(sub(sub(mul(retention,point.x),fixed),point.y)),fraction(1))>0n)) return {...summary,reason:"Variable promotions or nonlinear deductions do not fit a stable percentage-plus-fixed model."};
  const conservativeFixed=points.reduce((result,point)=>{const needed=sub(mul(retention,point.x),point.y);return compare(needed,result)>0n?needed:result;},fixed);
  return {...summary,retention,fixed:conservativeFixed,minimumObservedPrice:money(low.x),maximumObservedPrice:money(high.x), modeledDeductionPercent:percent(sub(fraction(1),retention)), modeledFixedCharge:minorDecimal(ceil(conservativeFixed))};
}

export function recommendTikTokPrice(product, history = {}, settings = {}, overrides = {}) {
  const prefs={...pricingSettings(settings)};
  if(overrides.targetMargin!==undefined) prefs.pricingTargetMargin=overrides.targetMargin;
  const result={ currency:product.currency, preferences:prefs, history:Object.fromEntries(Object.entries(history).filter(([key])=>!["retention","fixed"].includes(key))), currentPrice:product.price ?? null, warnings:[] };
  const errors=validatePricingSettings(prefs);
  if(Object.keys(errors).length) return {...result,status:"invalid_preferences",message:Object.values(errors)[0]};
  if(product.capitalCostMinor==null) return {...result,status:"missing_capital",message:"Set Capital Cost"};
  if(product.currency!=="PHP") return {...result,status:"unsupported_currency",message:"Pricing requires PHP capital and listing amounts; no currency conversion is assumed."};
  let capital;
  try {capital=BigInt(product.capitalCostMinor);if(capital<0n)throw Error();}catch{return {...result,status:"missing_capital",message:"Set Capital Cost"};}
  const manual=overrides.useManual===true || !history.retention;
  const rate=overrides.deductionRate ?? prefs.pricingDeductionRate;
  if(manual && rate==null) return {...result,status:"insufficient_data",message:"Insufficient Settlement Data",warnings:[history.reason || "No reliable history for this variant. Configure an assumed deduction rate to make a projection."]};
  try {
    let retention,fixed; let discount=fraction(1); let fixedDiscount=0n;
    if(manual) {
      const bp=decimalMinor(rate);if(bp>=10000n)throw Error("Deduction rate must be below 100%.");
      const discountBp=decimalMinor(overrides.discountPercent ?? 0);if(discountBp>=10000n)throw Error("Seller discount must be below 100%.");
      retention=fraction(10000n-bp,10000n); discount=fraction(10000n-discountBp,10000n);
      fixedDiscount=decimalMinor(overrides.discountFixed ?? 0);fixed=fraction(decimalMinor(overrides.fixedCharge ?? 0));
      result.warnings.push("Assumed deductions, fixed charges and promotions are not confirmed TikTok fees. Verify all applicable deductions before using this price.");
      if(history.reason)result.warnings.push(history.reason);
    } else {
      retention=history.retention;fixed=fraction(ceil(history.fixed));
      result.warnings.push("Historical percentage and fixed components are inferred together from actual settlements, including observed discounts, fees and shipping. They are not an official fee schedule. Future promotions, subsidies and nonlinear fees may differ.");
    }
    const a=mul(retention,discount), b=add(fixed,mul(retention,fraction(fixedDiscount)));
    const expense=decimalMinor(prefs.pricingOperatingExpense),cost=capital+expense;
    const target=decimalMinor(prefs.pricingTargetMargin),minimum=decimalMinor(prefs.pricingMinimumMargin);
    // Require a visible extra basis point above the minimum, including target=20%.
    const requiredTarget=target>minimum?target:minimum+1n;
    const requiredSettlement=cost===0n?1n:ceil(fraction(cost*10000n,10000n-requiredTarget));
    const increment=decimalMinor(prefs.pricingRoundingIncrement);
    const rawPrice=ceil(div(add(fraction(requiredSettlement),b),a));
    const price=((rawPrice+increment-1n)/increment)*increment;
    if(price>100000000000n)throw Error("The required price exceeds the supported pricing range.");
    const settlement=floor(sub(mul(a,fraction(price)),b));const profit=settlement-cost;
    if(settlement<=0n || profit*10000n<=settlement*minimum || profit*10000n<settlement*target)throw Error("No supported price meets the requested margins.");
    let difference=null;try{difference=minorDecimal(price-decimalMinor(product.price));}catch{}
    const current=(()=>{try{const value=floor(sub(mul(a,fraction(decimalMinor(product.price))),b));return {settlement:minorDecimal(value),margin:value>0n?percent(fraction(value-cost,value)):null};}catch{return null;}})();
    if(!manual && (price<decimalMinor(history.minimumObservedPrice)||price>decimalMinor(history.maximumObservedPrice)))result.warnings.push("This price is outside the historical price range; extrapolation is less reliable.");
    return {...result,status:"ready",source:manual?"manual_assumption":"historical_affine_estimate",capital:minorDecimal(capital),operatingExpense:minorDecimal(expense),suggestedPrice:minorDecimal(price),estimatedSettlement:minorDecimal(settlement),estimatedProfit:minorDecimal(profit),estimatedMargin:percent(fraction(profit,settlement)),differenceFromCurrent:difference,currentProjection:current,deductionPercent:percent(sub(fraction(1),retention)),fixedCharge:minorDecimal(ceil(fixed)),discountPercent:percent(sub(fraction(1),discount)),discountFixed:minorDecimal(fixedDiscount),roundingIncrement:minorDecimal(increment),minimumMargin:prefs.pricingMinimumMargin,targetMargin:prefs.pricingTargetMargin,formula:"Estimated settlement = (selling price × (1 − seller discount %) − fixed seller discount) × (1 − deduction %) − fixed charge. Estimated profit = settlement − capital − operating expense. Settlement is rounded down to cents; selling price is rounded up."};
  } catch(error) {return {...result,status:"unavailable",message:error.message};}
}
