'use strict';
const {chromium} = require('playwright');
const fs=require('fs');
(async () => {
 const out='promo/probe-output';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const ctx=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const page=await ctx.newPage();
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,220)));
 page.on('response',r=>{if(r.status()>=500)console.log('SERVER ERROR',r.status(),r.url().slice(0,100));});
 try {
  const res=await page.goto('https://anime-game-server.onrender.com/',{waitUntil:'domcontentloaded',timeout:110000});
  console.log('SITE STATUS',res?.status(),'URL',page.url());
  await page.waitForTimeout(9500);
  await page.screenshot({path:out+'/home.png',fullPage:false});
  console.log('TITLE',await page.title());
  const d=await page.evaluate(()=>{
    const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const serial=e=>({tag:e.tagName,id:e.id,cls: String(e.className||'').slice(0,90),text:(e.innerText||e.textContent||'').trim().replace(/\s+/g,' ').slice(0,105),title:e.title||'',href:e.href||'',dataTab:e.dataset.tab||'',dataPage:e.dataset.page||'',onclick:e.getAttribute('onclick')||''});
    return {
      title:document.title,
      headings:[...document.querySelectorAll('h1,h2,h3')].filter(vis).slice(0,80).map(serial),
      nav:[...document.querySelectorAll('nav,header,.nav,.navbar,.tabs,.sidebar,.menu')].filter(vis).slice(0,18).map(e=>({tag:e.tagName,id:e.id,cls:String(e.className).slice(0,100),text:(e.innerText||'').replace(/\s+/g,' ').slice(0,500)})),
      buttons:[...document.querySelectorAll('button, [role="button"]')].filter(vis).slice(0,180).map(serial),
      links:[...document.querySelectorAll('a')].filter(vis).slice(0,120).map(serial),
      inputs:[...document.querySelectorAll('input')].filter(vis).slice(0,60).map(serial),
      bodyText:(document.body.innerText||'').slice(0,4500)
    };
  });
  fs.writeFileSync(out+'/ui.json',JSON.stringify(d,null,2));
  console.log('VISIBLE HEADINGS',JSON.stringify(d.headings.slice(0,30)));
  console.log('VISIBLE BUTTONS',JSON.stringify(d.buttons.slice(0,100)));
  console.log('VISIBLE LINKS',JSON.stringify(d.links.slice(0,45)));
  console.log('BODY',d.bodyText.slice(0,1800));
 }catch(e){console.log('ERROR',e.stack.slice(0,2000));await page.screenshot({path:out+'/error.png'}).catch(()=>{});}
 await ctx.close();await browser.close();
})();