'use strict';
const {chromium}=require('playwright'),fs=require('fs'),crypto=require('crypto');
const OUT='promo/demo-cards-output';fs.mkdirSync(OUT,{recursive:true});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR',deviceScaleFactor:1,recordVideo:{dir:OUT,size:{width:1280,height:720}}});
const page=await ctx.newPage();page.setDefaultTimeout(8000);let shots=[],T=Date.now();
page.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,140)));
const read=async()=>(await page.locator('body').innerText().catch(()=>'' )).replace(/\s+/g,' ').slice(0,3500);
const snap=async name=>{
 await page.screenshot({path:OUT+'/'+name+'.png'}).catch(()=>{});
 const state={name,t:+((Date.now()-T)/1000).toFixed(2),body:(await read()).slice(0,2000),
 buttons:await page.evaluate(()=>[...document.querySelectorAll('button,input,a')].filter(e=>e.offsetWidth>0).slice(0,100).map(e=>({tag:e.tagName,id:e.id,text:(e.innerText||'').replace(/\s+/g,' ').slice(0,65),type:e.type,placeholder:e.placeholder,onclick:e.getAttribute('onclick')})))};
 shots.push(state);fs.writeFileSync(OUT+'/shots.json',JSON.stringify(shots,null,2));console.log('SHOT',name,state.body.slice(0,950));console.log('BTNS',name,JSON.stringify(state.buttons).slice(0,6500));};
async function tile(text){
 const r=await page.evaluate(text=>{
  const els=[...document.querySelectorAll('button,[onclick]')].filter(e=>e.offsetWidth>0&&(e.innerText||'').includes(text)&&(e.innerText||'').length<90);
  els.sort((a,b)=>a.innerText.length-b.innerText.length);
  if(!els.length)return null;els[0].click();return els[0].outerHTML.slice(0,210);
 },text);
 console.log('TILE',text,r);await sleep(1100);return !!r;
}
async function nav(section){
 await page.goto('https://anime-game-server.onrender.com/',{waitUntil:'domcontentloaded',timeout:80000});
 await page.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:12500});
 let target=page.locator('.ag-dash-nav-btn').filter({hasText:new RegExp(section,'i')}).first();
 await target.click({timeout:5500});
 await sleep(730);
}
try{
 await page.goto('https://anime-game-server.onrender.com/',{waitUntil:'domcontentloaded',timeout:100000});
 await sleep(700);await snap('00_login');
 await page.locator('#auth-switch-link').click({timeout:7000});
 await sleep(500);await snap('01_register_view');
 const email='animegame-video-'+Date.now()+'@example.test',pass='An1meVideo!'+crypto.randomBytes(12).toString('hex');
 const visible=await page.locator('input:visible').evaluateAll(xs=>xs.map(x=>({id:x.id,type:x.type,placeholder:x.placeholder,name:x.name})));
 console.log('INPUT_FIELDS',JSON.stringify(visible));
 for(const f of visible){
   if(/email|mail/i.test(f.id+' '+f.type+' '+f.placeholder+' '+f.name))await page.locator('#'+f.id).fill(email).catch(()=>{});
   if(/pass|mot de passe/i.test(f.id+' '+f.type+' '+f.placeholder+' '+f.name))await page.locator('#'+f.id).fill(pass).catch(()=>{});
   if(/pseudo|user|name|nom/i.test(f.id+' '+f.placeholder+' '+f.name)&&!/email/i.test(f.id))await page.locator('#'+f.id).fill('AGCardFilm'+String(Date.now()).slice(-8)).catch(()=>{});
 }
 await snap('02_register_form');
 await page.locator('#auth-submit-btn').click({timeout:7000,noWaitAfter:true});
 await sleep(3100);await snap('03_register_result');
 let logged=await page.locator('.ag-dash-nav-btn').first().isVisible().catch(()=>false) || await page.locator('#btn-collection').isVisible().catch(()=>false);
 console.log('REGISTER_LOGGED',logged);
 if(!logged){console.log('ACCOUNT_UNAVAILABLE');return;}
 await nav('COLLECTION');await snap('04_collection');
 await tile('Mystery Box');await snap('05_mystery_box');
 let btns=await page.locator('button:visible').allTextContents();console.log('AFTER_MYSTERY_BUTTONS',btns.filter(Boolean).slice(-50));
 const reveal=page.locator('button:visible').filter({hasText:/Tout révéler/i}).first();
 if(await reveal.isVisible().catch(()=>false)){await reveal.click({timeout:6000,noWaitAfter:true});await sleep(1600);await snap('06_mystery_open');}
 const close=page.locator('button:visible').filter({hasText:/Fermer|Terminer|Continuer/i}).last();
 if(await close.isVisible().catch(()=>false)){await close.click({timeout:5000,noWaitAfter:true}).catch(()=>{});await sleep(600);}
 await nav('COLLECTION');await tile('Classeur');await snap('07_classeur');
 await nav('COLLECTION');await tile('Albums secrets');await snap('08_secret_albums');
 await nav('COLLECTION');await tile('Fusions');await snap('09_fusions');
 await nav('COLLECTION');await tile('Cadres');await snap('10_card_frames');
 await nav('COLLECTION');await tile('Roue de la fortune');await snap('11_wheel');
 await nav('COLLECTION');await tile('Défis de deck');await snap('12_deck_challenges');
 await nav('DECKS');await snap('13_deck_builder');
 await nav('BOUTIQUE');await snap('14_shop');
 await nav('ÉCHANGES');await snap('15_card_trading');
 await nav('MUS.E');await snap('16_museum');
 await sleep(550);
}finally{
 fs.writeFileSync(OUT+'/shots.json',JSON.stringify(shots,null,2));
 const v=page.video();await page.close().catch(()=>{});
 try{if(v)await v.saveAs(OUT+'/animegame_cards_demo.webm')}catch(e){console.log('SAVEERR',e.message)}
 await ctx.close().catch(()=>{});await browser.close().catch(()=>{});
 console.log('FINISHED',shots.map(s=>s.name).join(','));
}
})().catch(e=>{console.log('FATAL',e.stack);process.exitCode=1});