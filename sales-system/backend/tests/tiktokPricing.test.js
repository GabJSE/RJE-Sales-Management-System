import test from "node:test";
import assert from "node:assert/strict";
import { decimalMinor, fitPricingHistory, recommendTikTokPrice, validatePricingSettings, pricingDefaults } from "../services/tiktokPricingMath.js";
import { pricingHistorySamples } from "../services/tiktokPricingService.js";
const product = { _id:"v1", tiktokProductId:"p1", tiktokSkuId:"s1", currency:"PHP", price:"200.00", capitalCostMinor:"10000" };
const manual = (cost, rate, prefs={}, overrides={}) => recommendTikTokPrice({...product,capitalCostMinor:cost}, {}, {pricingDeductionRate:rate,...prefs}, overrides);
const samples = [10000n,20000n,30000n].map(grossMinor=>({grossMinor,settlementMinor:grossMinor*9n/10n-500n,units:1n}));
test("integer cents reject malformed or silently truncated monetary inputs",()=>{
  for(const input of ["",null,undefined,"1.001",-1,Infinity,"1e2",{},"NaN"])assert.throws(()=>decimalMinor(input));
  assert.equal(decimalMinor("0.01"),1n);assert.equal(decimalMinor("1000000000"),100000000000n);
});
test("percentage formula accounts for settlement-cent rounding before claiming target margin",()=>{
  const result=manual("10000",10);
  assert.equal(result.status,"ready");assert.equal(result.suggestedPrice,"148.16");assert.equal(result.estimatedSettlement,"133.34");assert.equal(result.estimatedProfit,"33.34");assert.ok(result.estimatedMargin>=25);assert.equal(result.source,"manual_assumption");
  assert.equal(result.differenceFromCurrent,"-51.84");assert.ok(result.warnings.length);
});
test("different capital and deduction rates meet both target and minimum using exact cents",()=>{
  for(const cost of ["0","1","50","10000","193625","99999999"])for(const rate of [0,.01,5,25,70,99.99]) {
    const result=manual(cost,rate); if(result.status!=="ready"){assert.match(result.message,/range/);continue;}
    const settlement=decimalMinor(result.estimatedSettlement);const profit=settlement-BigInt(cost);
    assert.ok(profit*10000n>settlement*2000n);assert.ok(profit*10000n>=settlement*2500n);
  }
});
test("price increments round up, never to nearest or down",()=>{
  for(const increment of [.01,.05,.25,1,5,10]) {
    const result=manual("10000",10,{pricingRoundingIncrement:increment});assert.equal(result.status,"ready");
    assert.equal(decimalMinor(result.suggestedPrice)%decimalMinor(increment),0n);assert.ok(result.estimatedMargin>=25);
  }
});
test("target equal to minimum cannot produce exactly twenty percent",()=>{
  const result=manual("8000",0,{pricingTargetMargin:20});assert.equal(result.suggestedPrice,"100.02");assert.ok(result.estimatedMargin>=20.01);
  const higher=manual("6500",0,{pricingMinimumMargin:35,pricingTargetMargin:35});assert.ok(higher.estimatedMargin>=35.01);
});
test("fixed fees, fixed and percentage seller discounts and external expenses apply exactly once",()=>{
  const result=manual("10000",10,{pricingOperatingExpense:5},{useManual:true,deductionRate:10,fixedCharge:3,discountFixed:2,discountPercent:20});
  assert.equal(result.status,"ready");
  const p=decimalMinor(result.suggestedPrice);
  // S = (P * .8 - 2 PHP) * .9 - 3 PHP; floor only the final settlement.
  const expected=(p*8n*9n-200n*10n*9n-300n*100n)/100n;
  assert.equal(decimalMinor(result.estimatedSettlement),expected);assert.equal(decimalMinor(result.estimatedProfit),expected-10500n);assert.ok(result.estimatedMargin>=25);
});
test("unavailable and impossible inputs do not fabricate suggested prices",()=>{
  assert.equal(manual(null,10).message,"Set Capital Cost");assert.equal(manual("10000",null).message,"Insufficient Settlement Data");
  assert.equal(manual("10000",100).status,"invalid_preferences");assert.equal(manual("10000",0,{pricingTargetMargin:100}).status,"invalid_preferences");
  assert.equal(manual("10000",10,{}, {useManual:true,deductionRate:10,discountPercent:100}).status,"unavailable");
  assert.equal(manual("100000000000",99.99).status,"unavailable");
  assert.equal(recommendTikTokPrice({...product,currency:"USD"},{},{pricingDeductionRate:10}).status,"unsupported_currency");
});
test("historical affine model identifies fixed charges instead of treating them as percentage fees",()=>{
  const history=fitPricingHistory(samples);assert.deepEqual(history.retention,{n:9n,d:10n});assert.equal(history.modeledFixedCharge,"5.00");assert.equal(history.effectiveDeductionPercent,12.5);
  const result=recommendTikTokPrice(product,history);assert.equal(result.status,"ready");assert.equal(result.source,"historical_affine_estimate");assert.equal(result.suggestedPrice,"153.72");assert.equal(result.fixedCharge,"5.00");assert.ok(result.estimatedMargin>=25);
});
test("insufficient prices, nonlinear promotions, subsidies and zero/negative settlement are rejected",()=>{
  assert.equal(fitPricingHistory(samples.slice(0,2)).retention,undefined);
  assert.match(fitPricingHistory([samples[0],samples[0],samples[0]]).reason,/Different historical prices/);
  assert.match(fitPricingHistory([10000n,10001n,10002n].map(grossMinor=>({grossMinor,settlementMinor:grossMinor*9n/10n,units:1n}))).reason,/variation is too small/);
  assert.match(fitPricingHistory([samples[0],{...samples[1],settlementMinor:16000n},samples[2]]).reason,/Variable promotions/);
  assert.equal(fitPricingHistory(samples.map(row=>({...row,settlementMinor:0n}))).sampleCount,0);
  assert.equal(fitPricingHistory(samples.map(row=>({...row,settlementMinor:-1n}))).sampleCount,0);
  assert.equal(fitPricingHistory(samples.map(row=>({...row,settlementMinor:row.grossMinor+1n}))).sampleCount,0);
});
test("a configured fallback is explicitly assumed; history takes precedence unless overridden",()=>{
  const history=fitPricingHistory(samples);
  assert.equal(recommendTikTokPrice(product,history,{pricingDeductionRate:50}).deductionPercent,10);
  assert.equal(recommendTikTokPrice(product,history,{}, {targetMargin:10}).history.sampleCount,3);
  assert.equal(recommendTikTokPrice(product,history,{}, {useManual:true,deductionRate:30}).source,"manual_assumption");
  assert.equal(recommendTikTokPrice(product,{reason:"Unreliable history"},{pricingDeductionRate:12}).source,"manual_assumption");
});
test("pricing preference validation enforces precision, bounds, and the minimum-target relationship",()=>{
  assert.deepEqual(validatePricingSettings(pricingDefaults),{});
  for(const patch of [{pricingMinimumMargin:19.99},{pricingTargetMargin:100},{pricingMinimumMargin:30,pricingTargetMargin:25},{pricingDeductionRate:100},{pricingRoundingIncrement:0},{pricingOperatingExpense:-1},{pricingOperatingExpense:"0.001"},{pricingDeductionRate:""}])assert.ok(Object.keys(validatePricingSettings({...pricingDefaults,...patch})).length);
});
test("history attribution excludes mixed SKUs, returns, adjustments, unconfirmed statements and multi-unit fixed-fee ambiguity",()=>{
  const makeOrder=(gross,index)=>({status:"COMPLETED",currency:"PHP",lines:[{productId:"p1",skuId:"s1",quantity:1,originalPrice:String(gross/100n)}],transactions:[{transactionType:"ORDER",reconciliationStatus:"reconciled",confirmed:true,profitMinor:"1",currency:"PHP",revenueMinor:String(gross),settlementMinor:String(samples[index].settlementMinor)}]});
  const orders=samples.map((row,index)=>makeOrder(row.grossMinor,index));
  assert.equal(pricingHistorySamples([product],orders).get("v1").sampleCount,3);
  for(const mutate of [o=>o.lines.push({...o.lines[0],skuId:"other"}),o=>o.lines[0].quantity=2,o=>o.transactions.push({...o.transactions[0],transactionType:"REFUND"}),o=>o.transactions[0].confirmed=false,o=>o.transactions[0].currency="USD",o=>o.transactions[0].adjustmentMinor="100",o=>o.transactions[0].refundMinor="100",o=>o.status="CANCELLED"]) {
    const copy=structuredClone(orders);copy.forEach(mutate);assert.equal(pricingHistorySamples([product],copy).get("v1").sampleCount,0);
  }
  const other={...product,_id:"v2",tiktokSkuId:"s2"};const split=pricingHistorySamples([product,other],orders);assert.ok(split.get("v1").retention);assert.equal(split.get("v2").sampleCount,0);
});
