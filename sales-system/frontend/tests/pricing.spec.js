import { test, expect } from "@playwright/test";
const prefs={pricingMinimumMargin:20,pricingTargetMargin:25,pricingDeductionRate:null,pricingRoundingIncrement:.01,pricingOperatingExpense:0};
const user={_id:"user",name:"Admin",username:"admin",email:"admin@example.test",role:"admin"};
const initialSettings={_id:"settings",businessName:"Fixture Shop",address:"",contactNumber:"",email:"",currency:"PHP",dateFormat:"DD/MM/YYYY",timezone:"Asia/Manila",defaultDashboardPeriod:"month",lowStockThreshold:5,enableLowStockAlerts:true,...prefs};
const ready={status:"ready",currency:"PHP",source:"historical_affine_estimate",preferences:prefs,targetMargin:25,minimumMargin:20,suggestedPrice:"153.72",estimatedSettlement:"133.34",estimatedProfit:"33.34",estimatedMargin:25.0037,differenceFromCurrent:"-46.28",capital:"100.00",operatingExpense:"0.00",deductionPercent:10,fixedCharge:"5.00",discountPercent:0,discountFixed:"0.00",roundingIncrement:"0.01",history:{sampleCount:3,settledUnits:3,averageOriginalPrice:"200.00",averageSettlement:"175.00",effectiveDeductionPercent:12.5},warnings:["Historical estimate; future promotions may differ."],formula:"Settlement less capital and expenses."};
async function setup(page,{theme="light",insufficient=false,missing=false}={}) {
  let saved={...initialSettings};const requests=[];
  const pricing=missing?{...ready,status:"missing_capital",message:"Set Capital Cost"}:insufficient?{...ready,status:"insufficient_data",message:"Insufficient Settlement Data",source:undefined,history:{sampleCount:0,settledUnits:0,reason:"At least three eligible settled orders are required."}}:ready;
  const product={_id:"variant",title:"Test Helmet",sellerSku:"HELMET-1",tiktokSkuId:"s1",status:"ACTIVE",currency:"PHP",price:"200.00",capitalCost:missing?null:100,variations:[{name:"Color",value:"Blue"}],stock:3,settlementProfitMargin:18,pricing};
  await page.addInitScript(({user,theme})=>{localStorage.setItem("rje_auth_token","fixture");localStorage.setItem("rje_auth_user",JSON.stringify(user));localStorage.setItem("rje-appearance",theme);},{user,theme});
  await page.route("**/api/**",route=>{
    const request=route.request(),url=new URL(request.url());requests.push({path:url.pathname,method:request.method(),query:Object.fromEntries(url.searchParams),body:request.postDataJSON()});
    let data;
    if(url.pathname==="/api/settings/pricing" && request.method()==="PUT") {saved={...saved,...request.postDataJSON()};data=saved;}
    else if(request.method()!=="GET")return route.fulfill({status:405,json:{message:"Fixture writes blocked"}});
    else if(url.pathname==="/api/auth/me")data=user;
    else if(url.pathname==="/api/settings")data=saved;
    else if(url.pathname==="/api/tiktok/products")data={products:[product],page:1,pages:1,total:1};
    else if(url.pathname==="/api/tiktok/products/variant/pricing") {
      const manual=url.searchParams.get("useManual")==="true";
      const invalid=manual && Number(url.searchParams.get("deductionRate"))>=100;
      data=invalid?{...ready,status:"unavailable",message:"Deduction rate must be below 100%."}:missing?pricing:!manual && insufficient?pricing:{...ready,targetMargin:Number(url.searchParams.get("targetMargin")),source:manual?"manual_assumption":ready.source,suggestedPrice:url.searchParams.get("targetMargin")==="40"?"200.00":ready.suggestedPrice};
    } else data={jobs:[],logs:[]};
    return route.fulfill({json:data});
  });
  return {requests};
}
for(const width of [390,1440])for(const theme of ["light","dark"])test(`pricing drawer is advisory, responsive and interactive: ${theme} ${width}`,async({page})=>{
  await page.setViewportSize({width,height:950});const {requests}=await setup(page,{theme});await page.goto("/tiktok/products");
  await page.getByRole("button",{name:"View pricing breakdown for HELMET-1"}).click();const dialog=page.getByRole("dialog");
  await expect(dialog.getByRole("heading",{name:"Estimated outcome — not confirmed profit"})).toBeVisible();
  await expect(dialog).toHaveCSS("background-color",theme==="dark"?"rgb(23, 32, 51)":"rgb(255, 255, 255)");
  await expect(dialog.getByText("₱153.72",{exact:true})).toBeVisible();
  await dialog.getByLabel("Target settlement profit margin (%)",{exact:true}).fill("40");await expect(dialog.locator(".pricing-projection").getByText("₱200.00",{exact:true})).toBeVisible();
  await dialog.getByLabel("Use manually assumed deductions and promotions").check();
  await dialog.getByLabel("Assumed deduction rate (%)",{exact:true}).fill("12");await dialog.getByLabel("Fixed charge per unit (PHP)",{exact:true}).fill("5");await dialog.getByLabel("Planned seller discount (%)",{exact:true}).fill("10");
  await expect.poll(()=>requests.filter(row=>row.query.fixedCharge==="5" && row.query.discountPercent==="10" && row.query.deductionRate==="12").length).toBeGreaterThan(0);
  await expect(dialog.getByText("Manual assumption",{exact:true})).toBeVisible();
  await dialog.locator(".pricing-projection").scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/pricing-ready-${theme}-${width}.png`});
  await dialog.getByLabel("Assumed deduction rate (%)",{exact:true}).fill("100");await expect(dialog.getByText("Deduction rate must be below 100%.",{exact:true})).toBeVisible();await expect(dialog.locator(".pricing-projection")).toHaveCount(0);
  const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:`test-results/pricing-${theme}-${width}.png`});
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);expect(requests.every(row=>row.method==="GET")).toBe(true);
});
test("insufficient history requires an explicit assumption",async({page})=>{
  await setup(page,{insufficient:true});await page.goto("/tiktok/products");await page.getByRole("button",{name:"View pricing breakdown for HELMET-1"}).click();
  await expect(page.getByRole("dialog").getByText("Insufficient Settlement Data",{exact:true})).toBeVisible();
  await page.getByLabel("Use manually assumed deductions and promotions").check();await page.getByLabel("Assumed deduction rate (%)",{exact:true}).fill("12");await expect(page.getByText("Manual assumption",{exact:true})).toBeVisible();
});
test("missing capital remains unavailable even when a manual rate is entered",async({page})=>{
  await setup(page,{missing:true});await page.goto("/tiktok/products");await page.getByRole("button",{name:"View pricing breakdown for HELMET-1"}).click();
  const dialog=page.getByRole("dialog");await expect(dialog.locator(".pricing-warning").first()).toContainText("Set Capital Cost");
  await dialog.getByLabel("Use manually assumed deductions and promotions").check();await dialog.getByLabel("Assumed deduction rate (%)",{exact:true}).fill("12");await expect(dialog.locator(".pricing-warning").first()).toContainText("Set Capital Cost");await expect(dialog.locator(".pricing-projection")).toHaveCount(0);
});
test("pricing settings save and reload including an intentionally blank fallback rate",async({page})=>{
  const {requests}=await setup(page);await page.goto("/settings");const card=page.locator("form.st-card").filter({has:page.getByRole("heading",{name:"Pricing Preferences",exact:true})});
  await card.getByLabel("Target settlement profit margin (%)",{exact:true}).fill("30");await card.getByLabel(/Fallback estimated deduction rate/).fill("12");await card.getByLabel("Round selling prices up by (PHP)",{exact:true}).fill("0.25");await card.getByLabel("Operating expenses per unit (PHP)",{exact:true}).fill("4.50");await card.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(card.getByText("Saved to your shop settings.",{exact:true})).toBeVisible();await page.reload();await expect(card.getByLabel("Target settlement profit margin (%)",{exact:true})).toHaveValue("30");await expect(card.getByLabel(/Fallback estimated deduction rate/)).toHaveValue("12");
  await card.getByLabel(/Fallback estimated deduction rate/).fill("");await card.getByRole("button",{name:"Save changes",exact:true}).click();await expect.poll(()=>requests.filter(row=>row.method==="PUT"&&row.body.pricingDeductionRate===null).length).toBe(1);
  await card.getByLabel("Minimum settlement profit margin (%)",{exact:true}).fill("35");await card.getByRole("button",{name:"Save changes",exact:true}).click();await expect(card.getByText("Target must be at least the minimum and below 100%.")).toBeVisible();
});
