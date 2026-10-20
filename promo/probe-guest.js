'use strict';
const { chromium }=require('playwright');
const fs=require('fs');
(async()=>{
 const out='promo/guest-output'; fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const page=await context.newPage();
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message.slice(0,180)));
 await page.goto('https://anime-game-server.onrender.com/',{waitUntil:'domcontentloaded',timeout:110000});
 await page.waitForTimeout(2100);
 console.log('GUEST LINK',await page.locator('a').filter({hasText:'Play as guest'}).count());
 await page.locator('a').filter({hasText:'Play as guest'}).click({timeout:8000});
 await page.waitForTimeout(3400);
 await page.screenshot({path:out+'/guest.png'});
 const p=await page.evaluate(()=>{
  const show=e=>{let r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
  const s=e=>({id:e.id,cls:String(e.className||'').slice(0,100),tag:e.tagName,txt:(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,155),onclick:e.getAttribute('onclick'),href:e.getAttribute('href')});
  return {url:location.href,body:(document.body.innerText||'').slice(0,10000),nav:[...document.querySelectorAll('nav,.nav,.sidebar,.tabs')].filter(show).map(s).slice(0,30),buttons:[...document.querySelectorAll('button,a,[role=button]')].filter(show).map(s).slice(0,170),inputs:[...document.querySelectorAll('input')].filter(show).map(s).slice(0,30)};
 });
 console.log('NAV',JSON.stringify(p.nav));
 console.log('BUTTONS',JSON.stringify(p.buttons));
 console.log('INPUTS',JSON.stringify(p.inputs));
 console.log('BODY',p.body.slice(0,6000));
 fs.writeFileSync(out+'/guest-ui.json',JSON.stringify(p,null,2));
 await context.close();await browser.close();
})().catch(e=>{console.log('ERROR',e.stack);process.exitCode=1;});