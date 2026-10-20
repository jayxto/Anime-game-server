'use strict';
const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{
 const out='promo/main-output';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const ctx=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,locale:'fr-FR'});
 const page=await ctx.newPage();
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,160)));
 await page.goto('https://anime-game-server.onrender.com/',{waitUntil:'domcontentloaded',timeout:110000});
 await page.waitForTimeout(1500);
 await page.locator('a').filter({hasText:'Play as guest'}).click();
 await page.locator('#guest-pseudo').fill('StreamerDemo2026');
 await page.locator('button[onclick*="playAsGuest"]').click();
 await page.waitForTimeout(5500);
 await page.screenshot({path:out+'/main.png'});
 const j=await page.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
  const ser=e=>({tag:e.tagName,id:e.id,cls:String(e.className||'').slice(0,95),text:(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,130),title:e.title||'',onclick:e.getAttribute('onclick')||'',dataTab:e.dataset.tab||''});
  return {url:location.href,title:document.title,body:(document.body.innerText||'').slice(0,15000),headers:[...document.querySelectorAll('h1,h2,h3')].filter(vis).slice(0,60).map(ser),buttons:[...document.querySelectorAll('button,a,[role="button"],[onclick]')].filter(vis).slice(0,250).map(ser),inputs:[...document.querySelectorAll('input')].filter(vis).slice(0,30).map(ser)};
 });
 console.log('LOCATION',j.url,'TITLE',j.title);
 console.log('HEADERS',JSON.stringify(j.headers));
 console.log('BUTTONS',JSON.stringify(j.buttons).slice(0,39000));
 console.log('BODY',j.body.slice(0,9500));
 fs.writeFileSync(out+'/main.json',JSON.stringify(j,null,2));
 await ctx.close();await browser.close();
})().catch(e=>{console.log('ERROR',e.stack);process.exitCode=1;});