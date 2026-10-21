import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { createPrismaClient } from "../../src/database.js";
import { hashPassword } from "../../src/password.js";
import { navigate } from "./navigation.js";
const db = createPrismaClient(process.env.TEST_DATABASE_URL), suffix = randomUUID(), password = "progress-browser-password";
const emails = [`progress-a-${suffix}@example.com`,`progress-b-${suffix}@example.com`], users: number[] = [], entries: number[] = [];
test.setTimeout(90000);
test.beforeAll(async () => {
  const hash = await hashPassword(password);
  for (let i=0;i<2;i++) users.push((await db.user.create({data:{name:i?"Ece Kaya":"Deniz Yılmaz",email:emails[i]!,password:hash}})).id);
});
test.afterAll(async () => {
  await db.operationEntry.deleteMany({where:{id:{in:entries}}});
  await db.user.deleteMany({where:{id:{in:users}}}); await db.$disconnect();
});
async function entry() {
  const item = await db.operationEntry.create({data:{authorId:users[0]!,kind:"TASK",title:`Progress ${randomUUID()}`,description:"Original inspection request",equipmentCode:"GT1",priority:"HIGH"}});
  entries.push(item.id); return item;
}
async function login(page: Page, who=0) {
  await page.locator("#email").fill(emails[who]!); await page.locator("#password").fill(password); await page.locator("#login-button").click();
  await expect(page.locator("#dashboard")).toBeVisible(); await expect(page.locator("#login-button")).toBeEnabled();
}
async function openUpdates(page: Page, id: number) {
  await navigate(page,"handover"); await page.locator(`[data-updates-for="${id}"]`).click();
  await expect(page.locator("#updates-form")).toBeVisible(); await expect(page.locator("#updates-save")).toBeEnabled();
}

test("two shifts share author-stamped notes; lost responses retry once and closure preserves history",async({page})=>{
  const item=await entry(), errors:string[]=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/app/"); await login(page);
  await page.locator(`#overview-important [data-entry-id="${item.id}"]`).click();
  await page.locator("#overview-detail-updates").click();
  await expect(page.locator("#updates-list")).toContainText("Henüz gelişme"); await expect(page.locator("#updates-form")).toBeHidden();
  await page.locator("#updates-handover").click();
  await page.locator(`[data-updates-for="${item.id}"]`).click();
  await expect(page.locator("#updates-form")).toBeVisible();
  await page.locator("#updates-body").fill("Bakım ekibine haber verildi."); await page.locator("#updates-save").click();
  await expect(page.locator("#updates-list")).toContainText("Bakım ekibine haber verildi.");
  await expect(page.locator("#updates-list")).toContainText("Deniz Yılmaz"); await expect(page.locator("#updates-body")).toHaveValue("");
  await page.locator("#updates-close").click();
  await expect(page.locator(`#board-entries [data-updates-for="${item.id}"]`)).toHaveText("Gelişmeler (1)");
  await page.locator("#logout").click(); await login(page,1); await openUpdates(page,item.id);
  await expect(page.locator("#updates-list")).toContainText("Bakım ekibine haber verildi.");
  await page.route(`**/operations/entries/${item.id}/updates`,async route=>{await route.fetch();await route.abort("failed");},{times:1});
  await page.locator("#updates-body").fill("Ölçüm yapıldı, değerlendirme bekleniyor."); await page.locator("#updates-save").click();
  await expect(page.locator("#updates-message")).toHaveClass(/error/); await expect(page.locator("#updates-save")).toBeEnabled();
  await expect(page.locator("#updates-body")).toHaveValue("Ölçüm yapıldı, değerlendirme bekleniyor.");
  await page.locator("#updates-save").click();
  await expect(page.locator("#updates-list .update-note")).toHaveCount(2);
  expect(await db.operationUpdate.count({where:{entryId:item.id}})).toBe(2);
  await expect(page.locator("#updates-list .update-note").first()).toContainText("Ece Kaya");
  await page.locator("#updates-close").click();
  await page.locator("#dashboard [data-language]").selectOption("en");
  await page.locator(`[data-updates-for="${item.id}"]`).click();
  await expect(page.locator("#updates-title")).toContainText("Updates");
  await page.setViewportSize({width:320,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator("#updates-dialog").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:"../progress-notes-mobile.png",fullPage:true});
  await page.locator("#updates-close").click();
  const card=page.locator("#board-entries .entry-card").filter({hasText:item.title});
  await card.getByRole("button",{name:"Close item",exact:true}).click(); await page.locator("#close-note").fill("Inspection completed"); await page.locator("#close-save").click();
  await expect(page.locator("#close-dialog")).toBeHidden();
  await navigate(page,"history"); await page.locator(`[data-updates-for="${item.id}"]`).click();
  await expect(page.locator("#updates-form")).toBeHidden(); await expect(page.locator("#updates-mode")).toContainText("closed");
  await expect(page.locator("#updates-list .update-note")).toHaveCount(2);
  expect((await db.operationEntry.findUniqueOrThrow({where:{id:item.id}})).description).toBe(item.description);
  expect(errors).toEqual([]);
});

test("an expired session restores an unsent progress draft only to the same account",async({page})=>{
  const item=await entry(); await page.goto("/app/");await login(page);await openUpdates(page,item.id);
  await page.locator("#updates-body").fill("Vardiya boyunca takip edilecek, henüz kaydedilmedi.");
  async function expire() {
    await page.route(`**/operations/entries/${item.id}/updates?page=*`,r=>r.fulfill({status:401,json:{error:"Expired"}}),{times:1});
    await page.locator("#updates-retry").click(); await expect(page.locator("#auth-view")).toBeVisible();
    await expect(page.locator("#updates-list")).toBeEmpty(); await expect(page.locator("#updates-body")).toHaveValue("");
  }
  await expire();await expect(page.locator("#auth-message")).toContainText("aynı hesapla");await login(page);await openUpdates(page,item.id);
  await expect(page.locator("#updates-body")).toHaveValue("Vardiya boyunca takip edilecek, henüz kaydedilmedi.");
  await expire();await login(page,1);await openUpdates(page,item.id);await expect(page.locator("#updates-body")).toHaveValue("");
  expect(await db.operationUpdate.count({where:{entryId:item.id}})).toBe(0);
});

test("a concurrent closure rejects a new note and preserves its draft for inspection",async({page})=>{
  const item=await entry();await page.goto("/app/");await login(page);await openUpdates(page,item.id);
  await page.locator("#updates-body").fill("Gönderimden önce kapanan iş için yazılmış not.");
  const token=jwt.sign({id:users[1]},"browser-test-only-secret-".repeat(3),{expiresIn:"1h"});
  expect((await page.request.post(`/operations/entries/${item.id}/close`,{headers:{Authorization:`Bearer ${token}`},data:{closeNote:"Another operator completed it"}})).status()).toBe(200);
  await page.locator("#updates-save").click();
  await expect(page.locator("#updates-form")).toBeVisible();await expect(page.locator("#updates-save")).toBeHidden();await expect(page.locator("#updates-body")).toHaveAttribute("readonly", "");await expect(page.locator("#updates-mode")).toContainText("kapalı");
  await expect(page.locator("#updates-body")).toHaveValue("Gönderimden önce kapanan iş için yazılmış not.");
  await expect(page.locator("#updates-discard")).toBeVisible(); await page.locator("#updates-discard").click();
  await expect(page.locator("#updates-body")).toHaveValue("");expect(await db.operationUpdate.count({where:{entryId:item.id}})).toBe(0);
});

test("progress pagination preserves unsent text and displays note content without interpreting HTML",async({page})=>{
  const item=await entry(), literal='<img src=x onerror="window.noteExecuted=true">';
  await db.operationUpdate.createMany({data:Array.from({length:21},(_,i)=>({entryId:item.id,authorId:users[0]!,requestId:randomUUID(),body:i===20?literal:`Inspection step ${i}`,createdAt:new Date("2020-01-01")}))});
  await page.goto("/app/");await login(page);await openUpdates(page,item.id);
  await expect(page.locator("#updates-list .update-note")).toHaveCount(20);
  await expect(page.locator("#updates-list")).toContainText(literal); await expect(page.locator("#updates-list img")).toHaveCount(0);
  await page.locator("#updates-body").fill("Draft is not a saved update yet");
  await page.locator("#updates-next").click();await expect(page.locator("#updates-list .update-note")).toHaveCount(1);
  await expect(page.locator("#updates-page")).toContainText("21–21 / 21");await expect(page.locator("#updates-body")).toHaveValue("Draft is not a saved update yet");
  await page.locator("#updates-previous").click();await expect(page.locator("#updates-list .update-note")).toHaveCount(20);
  await page.locator("#updates-close").click();await page.locator(`[data-updates-for="${item.id}"]`).click();
  await expect(page.locator("#updates-body")).toHaveValue("Draft is not a saved update yet");
  await page.locator("#updates-discard").click();expect(await page.evaluate(()=>(window as any).noteExecuted)).toBeUndefined();
  expect(await db.operationUpdate.count({where:{entryId:item.id}})).toBe(21);
});
