'use strict';
const { chromium }=require('playwright'); const fs=require('fs'); const out='promo/modes-probe-output';fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1366,height:768},locale:'fr-FR',deviceScaleFactor:1});
const page=await context.newPage();page.setDefaultTimeout(8000);
const logs=[];
page.on('pageerror',e=>logs.push({type:'js-error',msg:e.message.slice(0,190)}));
async function snapshot(name){
 await page.screenshot({path:out+'/'+name+'.png'}).catch(()=>{});
 const v=await page.evaluate(()=>{
 const vis=e=>{let r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
 const elems=[...document.querySelectorAll('button,a,[role=button],input,[onclick],.modal')].filter(vis).slice(0,220).map(e=>({tag:e.tagName,text:(e.innerText||e.value||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,100),id:e.id,cls:String(e.className||'').slice(0,65),onclick:e.getAttribute('onclick'),placeholder:e.getAttribute('placeholder')}));
 return {url:location.href,title:document.title,body:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,5000),elems};
 });
 logs.push({type:'snapshot',name,...v});
 console.log('SNAPSHOT',name,v.body.slice(0,1500));
 console.log('BUTTONS',name,JSON.stringify(v.elems.slice(-110)).slice(0,18000));
}
try{
 await page.goto('https://anime-game-server.onrender.com/',{waitUntil:'domcontentloaded',timeout:100000});
 await page.locator('a').filter({hasText:/Play as guest/i}).click();
 await page.locator('#guest-pseudo').fill('StreamerGameplayA');
 await page.locator('button[onclick*="playAsGuest"]').click({noWaitAfter:true});
 await page.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:22000});
 await sleep(1400);await snapshot('00_lobby');
 await page.locator('.ag-dash-nav-btn').filter({hasText:'JOUER'}).first().click();
 await sleep(1400);await snapshot('01_modes');
 await page.locator('[onclick="openArcadeGame(\'pixel\')"]').first().click({timeout:8000}).catch(e=>console.log('pixel click',e.message.slice(0,150)));
 await sleep(1300);await snapshot('02_pixel_selection');
 const nodes=await page.locator('button:visible').allTextContents();
 console.log('PIXEL_BUTTONS',nodes.map(s=>s.trim()).filter(Boolean).slice(-70));
 const startbtn=page.locator('button').filter({hasText:/Naruto|Dragon Ball|One Piece|Tous les animes|Tous les univers|Général|Aléatoire|Confirmer|Jouer|Créer/i}).filter({visible:true}).last();
 if(await startbtn.count()){console.log('TRY_START',await startbtn.innerText());await startbtn.click({timeout:5000}).catch(e=>console.log('failedclick',e.message.slice(0,140)));}
 await sleep(2000);await snapshot('03_pixel_created');
 const info=await page.evaluate(()=>Object.keys(window).filter(x=>/room|game|start|host|mode|ready/i.test(x)).slice(0,120));
 console.log('WINDOW_KEYS',JSON.stringify(info));
} finally {
 fs.writeFileSync(out+'/probe.json',JSON.stringify(logs,null,2));
 await context.close();await browser.close();
}
})().catch(e=>{console.log('FATAL',e.stack);process.exitCode=1});