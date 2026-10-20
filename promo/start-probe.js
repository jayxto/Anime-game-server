'use strict';
const {chromium}=require('playwright'),fs=require('fs');
const dir='promo/start-probe-output';fs.mkdirSync(dir,{recursive:true}); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR',recordVideo:{dir,size:{width:1280,height:720}}});
const p=await ctx.newPage();p.setDefaultTimeout(11000);
const bg=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR'});
const q=await bg.newPage();q.setDefaultTimeout(10000);
const info=[];
async function sign(page,name){
await page.goto('https://anime-game-server.onrender.com/',{waitUntil:'domcontentloaded',timeout:100000});
await page.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).click();
await page.locator('#guest-pseudo').fill(name);
await page.locator('button[onclick*="playAsGuest"]').click({noWaitAfter:true});
await page.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:20000});
}
async function snap(page,label){
await page.screenshot({path:dir+'/'+label+'.png'}).catch(()=>{});
const d=await page.evaluate(()=>{
const vis=e=>{let r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
return{body:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,2200),buttons:[...document.querySelectorAll('button')].filter(vis).map(e=>({t:e.innerText.slice(0,70),id:e.id,clk:e.getAttribute('onclick')})).slice(0,80)};
});
console.log('SNAP',label,d.body);console.log('BUTTONS',label,JSON.stringify(d.buttons).slice(0,4500));info.push({label,...d});
}
try{
await sign(p,'DemoHost2026');
await p.locator('button[onclick="createRoom(\'arcade\',\'pixel:beastars\')"]').first().click({timeout:8000});
await sleep(1200);
await snap(p,'01_pixel_room_host');
const body=await p.locator('body').innerText();
const m=body.match(/#([A-Z0-9]{4,8})/);const code=m?.[1];console.log('ROOM_CODE',code);
await p.locator('#btn-start-game').click({timeout:7000});
await sleep(1500);await snap(p,'02_started_one');
if(code){
await sign(q,'DemoGuest2026');
await q.locator('#join-code-input').fill(code);
await q.locator('button[onclick="joinRoomByCode()"]').first().click();
await sleep(1000);await snap(q,'03_join_guest');
await snap(p,'04_host_two');
if(await p.locator('#btn-start-game').isVisible().catch(()=>false))await p.locator('#btn-start-game').click().catch(e=>console.log('START2ERR',e.message.slice(0,170)));
await sleep(3500);
await snap(p,'05_game_host');
await snap(q,'06_game_guest');
}
}finally{
fs.writeFileSync(dir+'/probe.json',JSON.stringify(info,null,2));
const v=p.video();await p.close().catch(()=>{});
try{fs.copyFileSync(await v.path(),dir+'/probe.webm');}catch(e){console.log('COPYERR',e.message);}
await q.close().catch(()=>{});await ctx.close();await bg.close();await browser.close();
}
})().catch(e=>{console.log('FATAL',e.stack);process.exitCode=1});