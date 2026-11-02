import test from "node:test";
import assert from "node:assert/strict";
import { changedFields, settingsSnapshot, settingErrors, displayDate, displayCalendarDate, displayMoney, passwordValidation, connectionHealth } from "../../frontend/src/utils/settingsPresentation.js";
import { requestNavigation } from "../../frontend/src/utils/navigation.js";

test("settings drafts preserve saved blanks and detect changes per section", () => {
  const saved=settingsSnapshot({businessName:"Real shop",email:"",lowStockThreshold:0,enableLowStockAlerts:false});
  assert.equal(saved.email,""); assert.equal(saved.lowStockThreshold,"0"); assert.equal(saved.enableLowStockAlerts,false);
  assert.equal(changedFields({...saved},saved,["businessName","email"]),false);
  assert.equal(changedFields({...saved,email:"a@example.test"},saved,["email"]),true);
  assert.ok(settingErrors("business",{businessName:"shop",email:"invalid",contactNumber:"123"}).email);
  assert.ok(settingErrors("inventory",{lowStockThreshold:"2.5"}).lowStockThreshold);
});
test("date preferences consistently change format and display timezone without converting currency", () => {
  const value="2026-11-01T01:00:00Z";
  assert.equal(displayDate(value,{dateFormat:"DD/MM/YYYY",timezone:"Asia/Manila"}),"01/11/2026");
  assert.equal(displayDate(value,{dateFormat:"MM/DD/YYYY",timezone:"America/New_York"}),"10/31/2026");
  assert.equal(displayDate(value,{dateFormat:"YYYY-MM-DD",timezone:"UTC"},true),"2026-11-01, 01:00");
  assert.ok(displayMoney(100,"PHP").includes("100.00")); assert.ok(displayMoney(100,"USD").includes("100.00")); assert.equal(displayMoney(null),"Unconfirmed");
});
test("password feedback agrees with backend-safe length limits", () => {
  assert.ok(passwordValidation("short")); assert.equal(passwordValidation("a long unique passphrase"),""); assert.ok(passwordValidation("a".repeat(73)));
});
test("integration health uses actual authorization metadata and permits automatic access refresh", () => {
  assert.equal(connectionHealth({connected:false}),"Disconnected");
  assert.equal(connectionHealth({connected:true,shopId:"shop",scopes:["scope"],accessTokenExpiresAt:"2000-01-01"}),"Connected");
  assert.equal(connectionHealth({connected:true,shopId:"shop",scopes:["scope"],refreshTokenExpiresAt:"2000-01-01"}),"Expired");
  assert.equal(connectionHealth({connected:true,scopes:[]}),"Needs Attention");
});
test("in-app navigation is deferred by an unsaved-change guard until explicitly continued", t => {
  const previous=globalThis.window; globalThis.window=new EventTarget(); t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
  let count=0; requestNavigation(()=>count++); assert.equal(count,1);
  let action; window.addEventListener("rje-before-navigate",event=>{event.preventDefault();action=event.detail;});
  requestNavigation(()=>count++); assert.equal(count,1); action.proceed(); assert.equal(count,2);
});

test("calendar dates follow preferences without shifting Manila accounting dates", () => { assert.equal(displayCalendarDate("2026-11-01","MM/DD/YYYY"),"11/01/2026"); assert.equal(displayCalendarDate("2026-11-01","DD/MM/YYYY"),"01/11/2026"); assert.equal(displayCalendarDate("2026-02-29"),"Select date"); });
