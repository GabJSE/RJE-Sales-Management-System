import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import routes from "../routes/tiktokRoutes.js";
import settingsRoutes from "../routes/settingsRoutes.js";
import User from "../models/User.js";
import Shop from "../models/TikTokShop.js";
import Mapping from "../models/TikTokProductMapping.js";
import Order from "../models/TikTokOrder.js";
import Transaction from "../models/TikTokFinanceTransaction.js";
import Settlement from "../models/TikTokSettlement.js";
import Settings from "../models/SystemSettings.js";
import { signToken } from "../middleware/auth.js";
let mongo,server,base,token,staffToken,variant;
before(async()=>{
  process.env.JWT_SECRET="isolated-pricing-test-secret";
  mongo=await MongoMemoryServer.create({binary:{downloadDir:fileURLToPath(new URL("../node_modules/.cache/mongodb-memory-server",import.meta.url))}});
  await mongoose.connect(mongo.getUri("pricing_tests"));
  await Promise.all(Object.values(mongoose.models).map(model=>model.init()));
  const app=express();app.use(express.json());app.use("/api/tiktok",routes);app.use("/api/settings",settingsRoutes);app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({message:error.message}));
  server=await new Promise(resolve=>{const instance=app.listen(0,"127.0.0.1",()=>resolve(instance));});base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{
  await Promise.all(Object.values(mongoose.models).map(model=>model.deleteMany({})));
  const admin=await User.create({name:"Admin",username:"admin",email:"admin@example.test",password:"fixture-hash",role:"admin"});token=signToken(admin);
  const staff=await User.create({name:"Staff",username:"staff",email:"staff@example.test",password:"fixture-hash",role:"staff"});staffToken=signToken(staff);
  await Shop.create({shopId:"shop"});
  variant=await Mapping.create({shopId:"shop",tiktokProductId:"p1",tiktokSkuId:"s1",title:"Test product",capitalCostMinor:"10000",price:"200.00",currency:"PHP"});
  await Settlement.create({shopId:"shop",statementId:"statement",settlementDate:new Date(),reconciliationStatus:"reconciled",calculatedProfitMinor:"15000"});
  for(const [index,gross] of [10000n,20000n,30000n].entries()){
    await Order.create({shopId:"shop",orderId:`order-${index}`,currency:"PHP",status:"COMPLETED",createdAtTikTok:new Date(),lines:[{productId:"p1",skuId:"s1",originalPrice:String(gross/100n),salePrice:String(gross/100n),quantity:1,capitalCostMinorSnapshot:"10000"}]});
    await Transaction.create({shopId:"shop",transactionId:`txn-${index}`,statementId:"statement",tiktokOrderId:`order-${index}`,transactionType:"ORDER",currency:"PHP",reconciliationStatus:"reconciled",capitalCostKnown:true,capitalCostMinor:"10000",profitMinor:String(gross*9n/10n-10500n),revenueMinor:String(gross),settlementMinor:String(gross*9n/10n-500n),isCurrent:true});
  }
});
async function api(path,method="GET",body,auth=token){const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${auth}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()};}
test("real Mongo attribution and product endpoints return advisory SKU estimates without financial writes",async()=>{
  const before=await Promise.all([Order.find().lean(),Transaction.find().lean(),Settlement.find().lean(),Mapping.find().lean()]);
  const result=await api(`/api/tiktok/products/${variant._id}/pricing`);assert.equal(result.status,200);assert.equal(result.data.suggestedPrice,"153.72");assert.equal(result.data.history.sampleCount,3);
  const list=await api("/api/tiktok/products");assert.equal(list.status,200);assert.equal(list.data.products[0].pricing.suggestedPrice,"153.72");assert.equal(list.data.products[0].capitalCost,100);
  const adjusted=await api(`/api/tiktok/products/${variant._id}/pricing?targetMargin=40`);assert.ok(Number(adjusted.data.suggestedPrice)>153.72);
  const after=await Promise.all([Order.find().lean(),Transaction.find().lean(),Settlement.find().lean(),Mapping.find().lean()]);assert.deepEqual(after,before);
});
test("historical corrections, duplicate credits and mismatched statements cannot feed recommendations",async()=>{
  await Transaction.updateOne({transactionId:"txn-0"},{$set:{isCurrent:false}});
  assert.equal((await api(`/api/tiktok/products/${variant._id}/pricing`)).data.status,"insufficient_data");
  await Transaction.updateOne({transactionId:"txn-0"},{$set:{isCurrent:true}});
  await Transaction.create({shopId:"shop",transactionId:"adjustment",statementId:"statement",tiktokOrderId:"order-0",transactionType:"ADJUSTMENT",reconciliationStatus:"reconciled"});
  assert.equal((await api(`/api/tiktok/products/${variant._id}/pricing`)).data.history.sampleCount,2);
  await Settlement.updateOne({statementId:"statement"},{$set:{reconciliationStatus:"amount_mismatch"}});
  assert.equal((await api(`/api/tiktok/products/${variant._id}/pricing`)).data.history.sampleCount,0);
});
test("pricing preferences validate and persist together while staff can only read and project",async()=>{
  const prefs={pricingMinimumMargin:20,pricingTargetMargin:30,pricingDeductionRate:12,pricingRoundingIncrement:.25,pricingOperatingExpense:3.5};
  const saved=await api("/api/settings/pricing","PUT",prefs);assert.equal(saved.status,200);
  const loaded=await api("/api/settings");for(const [key,value] of Object.entries(prefs))assert.equal(loaded.data[key],value);
  assert.equal((await api("/api/settings/pricing","PUT",{...prefs,pricingMinimumMargin:35})).status,400);
  assert.equal((await api("/api/settings/pricing","PUT",{pricingTargetMargin:40})).status,400);
  assert.equal((await api("/api/settings/pricing","PUT",prefs,staffToken)).status,403);
  assert.equal((await api(`/api/tiktok/products/${variant._id}/pricing?useManual=true&deductionRate=15&fixedCharge=2&discountPercent=5&discountFixed=1`,"GET",null,staffToken)).data.source,"manual_assumption");
  await Transaction.updateMany({},{$set:{isCurrent:false}});
  const fallback=await api(`/api/tiktok/products/${variant._id}/pricing`);assert.equal(fallback.data.source,"manual_assumption");assert.equal(fallback.data.targetMargin,30);assert.equal(fallback.data.operatingExpense,"3.50");
  assert.equal((await Settings.findOne()).pricingDeductionRate,12);
});
test("variant isolation, unknown IDs, invalid queries and no-capital states are explicit",async()=>{
  const other=await Mapping.create({shopId:"shop",tiktokProductId:"p1",tiktokSkuId:"s2",currency:"PHP",capitalCostMinor:"5000"});
  assert.equal((await api(`/api/tiktok/products/${other._id}/pricing`)).data.status,"insufficient_data");
  await Mapping.updateOne({_id:variant._id},{$set:{capitalCostMinor:null}});
  assert.equal((await api(`/api/tiktok/products/${variant._id}/pricing`)).data.message,"Set Capital Cost");
  assert.equal((await api("/api/tiktok/products/bad-id/pricing")).status,400);
  assert.equal((await api(`/api/tiktok/products/${new mongoose.Types.ObjectId()}/pricing`)).status,404);
  assert.equal((await api(`/api/tiktok/products/${variant._id}/pricing?useManual=yes`)).status,400);
  assert.equal((await api(`/api/tiktok/products/${variant._id}/pricing?rate=10`)).status,400);
});
