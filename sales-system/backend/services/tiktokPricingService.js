import Order from "../models/TikTokOrder.js";
import Transaction from "../models/TikTokFinanceTransaction.js";
import Settlement from "../models/TikTokSettlement.js";
import { decimalMinor, fitPricingHistory, recommendTikTokPrice } from "./tiktokPricingMath.js";

const key = row => `${row.tiktokProductId}:${row.tiktokSkuId}:${row.currency}`;
export function pricingHistorySamples(products, orders) {
  const samples=new Map(products.map(product=>[key(product),[]]));
  for(const order of orders) {
    const first=order.lines?.[0]; if(!first || order.isSampleOrder || /CANCEL|RETURN|REFUND/i.test(order.status||"") || order.cancelledAtTikTok)continue;
    if(!order.lines.every(line=>line.skuId===first.skuId && line.productId===first.productId && (!line.currency || line.currency===order.currency)))continue;
    const target=samples.get(`${first.productId}:${first.skuId}:${order.currency}`);if(!target || target.length>=100)continue;
    const transactions=order.transactions || [];
    // Multiple credits, partial returns or subsequent adjustments are ambiguous per unit.
    if(transactions.length!==1)continue;
    const txn=transactions[0];if(txn.transactionType!=="ORDER" || txn.reconciliationStatus!=="reconciled" || txn.profitMinor==null || !txn.confirmed || txn.currency!==order.currency)continue;
    try {
      if(BigInt(txn.revenueMinor||0)<=0n || BigInt(txn.refundMinor||0)!==0n || BigInt(txn.adjustmentMinor||0)!==0n)continue;
      let units=0n,gross=0n;
      for(const line of order.lines){if(!Number.isSafeInteger(line.quantity)||line.quantity<=0)throw Error();const quantity=BigInt(line.quantity);gross+=decimalMinor(line.originalPrice)*quantity;units+=quantity;}
      // An unknown per-order fixed fee cannot safely be divided across a future basket.
      // A single-unit reference gives a conservative unit-price recommendation.
      if(units!==1n)continue;
      const settlement=BigInt(txn.settlementMinor);if(gross<=0n || settlement<=0n || settlement>gross)continue;
      target.push({grossMinor:gross,settlementMinor:settlement,units});
    }catch{ /* Missing/invalid prices and quantities cannot establish a pricing model. */ }
  }
  return new Map(products.map(product=>[String(product._id),fitPricingHistory(samples.get(key(product)))]));
}
export async function pricingHistories(shopId, products) {
  if(!products.length)return new Map();
  // One bounded batch, never one finance request per displayed product.
  const orders=await Order.aggregate([
    {$match:{shopId,"lines.skuId":{$in:products.map(row=>row.tiktokSkuId)}}},
    {$sort:{createdAtTikTok:-1}},{$limit:2000},
    {$lookup:{from:Transaction.collection.name,let:{orderId:"$orderId"},pipeline:[{$match:{shopId,isCurrent:{$ne:false},$expr:{$eq:["$tiktokOrderId","$$orderId"]}}},{$lookup:{from:Settlement.collection.name,let:{statementId:"$statementId"},pipeline:[{$match:{shopId,reconciliationStatus:"reconciled",$expr:{$eq:["$statementId","$$statementId"]}}},{$project:{_id:1}}],as:"statements"}},{$set:{confirmed:{$gt:[{$size:"$statements"},0]}}},{$project:{transactionType:1,currency:1,profitMinor:1,reconciliationStatus:1,settlementMinor:1,revenueMinor:1,refundMinor:1,adjustmentMinor:1,confirmed:1}}],as:"transactions"}},
    {$project:{lines:1,currency:1,status:1,cancelledAtTikTok:1,isSampleOrder:1,transactions:1}},
  ]).allowDiskUse(true);
  return pricingHistorySamples(products,orders);
}
export async function productPricing(shopId, products, settings, overrides={}) {
  const histories=await pricingHistories(shopId,products.filter(product=>product.capitalCostMinor!=null && product.currency==="PHP"));
  return new Map(products.map(product=>[String(product._id),recommendTikTokPrice(product,histories.get(String(product._id)),settings,overrides)]));
}
