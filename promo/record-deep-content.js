'use strict';
const fs=require('fs'),{chromium}=require('playwright');const OUT='promo/deep-content-output';fs.mkdirSync(OUT,{recursive:true});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const br=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await br.newContext({viewport:{width:1280,height:720},locale:'fr-FR',deviceScaleFactor:1,recordVideo:{dir:OUT,size:{width:1280,height:720}}});
const p=await ctx.newPage();p.setDefaultTimeout(6500);const chapters=[],T=Date.now();
p.on('pageerror',e=>console.log('JSERR',e.message.slice(0,120)));
const base='https://anime-game-server.onrender.com/';
async function body(){return (await p.locator('body').innerText().catch(()=>'' )).replace(/\s+/g,' ').slice(0,2400);}
async function state(){return p.evaluate(()=>{
 const v=e=>{let r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
 return {body:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,2500),
 controls:[...document.querySelectorAll('button,[onclick],input')].filter(v).slice(0,180).map(x=>({txt:(x.innerText||x.value||'').replace(/\s+/g,' ').slice(0,65),id:x.id,onclick:x.getAttribute('onclick'),cls:String(x.className||'').slice(0,60)}))}
})}
async function scene(name,fn,ms=1300){
 const start=(Date.now()-T)/1000;let ok=true,error='';
 try{await fn();await sleep(ms);}catch(e){ok=false;error=e.message.slice(0,200);console.log('FAIL',name,error);}
 const data=await state();await p.screenshot({path:OUT+'/screen_'+name+'.png'}).catch(()=>{});
 const x={name,start,end:(Date.now()-T)/1000,ok,error,body:data.body};
 chapters.push(x);fs.writeFileSync(OUT+'/chapters.json',JSON.stringify(chapters,null,2));
 fs.writeFileSync(OUT+'/buttons_'+name+'.json',JSON.stringify(data.controls,null,2));
 console.log('SCENE',name,ok,'BODY',data.body.slice(0,620));
}
async function init(){
 await p.goto(base,{waitUntil:'domcontentloaded',timeout:100000});
 if(await p.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).first().isVisible().catch(()=>false)){
  await p.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).first().click({timeout:6500});
  await p.locator('#guest-pseudo').fill('AnimeGameShow');
  await p.locator('button[onclick*="playAsGuest"]').first().click({noWaitAfter:true,timeout:6500});
 }
 await p.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:17000});
 await p.locator('#music-collapse-btn').first().click().catch(()=>{});
 await sleep(500);
}
async function scrollTop(){await p.mouse.move(730,400);await p.mouse.wheel(0,-3500);await sleep(350)}
async function nav(s){
 await p.goto(base,{waitUntil:'domcontentloaded',timeout:100000});
 if(!await p.locator('.ag-dash-nav-btn').first().isVisible().catch(()=>false))await init();
 await p.locator('.ag-dash-nav-btn').filter({hasText:new RegExp(s,'i')}).first().click({timeout:6000});
 await sleep(630);await scrollTop();
}
async function clickTitle(name){
 const r=await p.evaluate(name=>{
 let els=[...document.querySelectorAll('body *')].filter(e=>{
  const a=(e.innerText||'').replace(/\s+/g,' ').trim();
  return a===name && e.getBoundingClientRect().width>0 && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none';
 });
 els.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
 let e=els[0];
 if(!e)return {clicked:false,found:0};
 let target=e.closest('button,a,[onclick],[role="button"]')||e.parentElement||e;
 target.click();
 return {clicked:true,text:(e.innerText||'').slice(0,60),tag:target.tagName,outer:target.outerHTML.slice(0,340)};
 },name);
 console.log('DEEPCLICK',name,JSON.stringify(r));if(!r.clicked)throw Error('missing '+name);
 await sleep(750);
}
async function pick(title){await nav('COLLECTION');await clickTitle(title)}
try{
 await scene('00_debut',init,1100);
 await scene('01_collection_cartes',async()=>{await nav('COLLECTION')});
 await scene('02_classeur_ouvrir',async()=>{await pick('Classeur')},1400);
 await scene('03_classeur_parcours',async()=>{await p.mouse.move(850,450);await p.mouse.wheel(0,470)},1500);
 await scene('04_albums_secrets',async()=>{await pick('Albums secrets')},1400);
 await scene('05_fusions',async()=>{await pick('Fusions')},1500);
 await scene('06_recyclage',async()=>{await pick('Recyclage')},1300);
 await scene('07_boutique_mystery_box',async()=>{await nav('BOUTIQUE');await clickTitle('Mystery Box')},1400);
 await scene('08_boutique_cosmetiques',async()=>{await nav('BOUTIQUE');await clickTitle('Cadres')},1500);
 await scene('09_roue_chance',async()=>{await nav('COLLECTION');await clickTitle('Roue de la fortune')},1700);
 await scene('10_defi_decks',async()=>{await nav('COLLECTION');await clickTitle('Défis de deck')},1300);
 await scene('11_marche_noir',async()=>{await nav('COLLECTION');await clickTitle('Marché noir')},1300);
 await scene('12_quetes_jeu',async()=>{await nav('QU.TES')},1200);
 await scene('13_profil',async()=>{await nav('PARAM.TRES');await scrollTop()},800);
 await scene('14_panneau_streamer_twitch',async()=>{
  let title=p.getByRole('heading',{name:/Mode streamer/i}).first();
  await title.scrollIntoViewIfNeeded({timeout:6000});
  await sleep(300);
  const tw=p.locator('button[onclick="streamSetPlatform(\'twitch\')"]').first();
  if(await tw.isVisible().catch(()=>false))await tw.click({timeout:5500});
 },2200);
 await scene('15_panneau_streamer_tiktok',async()=>{
  let title=p.getByRole('heading',{name:/Mode streamer/i}).first();
  await title.scrollIntoViewIfNeeded({timeout:6000});
  const tt=p.locator('button[onclick="streamSetPlatform(\'tiktok\')"]').first();
  await tt.click({timeout:5500});
 },2200);
 await scene('16_streamer_retour_twitch',async()=>{
  const tw=p.locator('button[onclick="streamSetPlatform(\'twitch\')"]').first();
  await tw.click({timeout:5500});await p.getByRole('heading',{name:/Mode streamer/i}).first().scrollIntoViewIfNeeded();
 },1000);
 await scene('17_app_accessibilite',async()=>{await scrollTop()},1200);
 await scene('18_jeu_chat_streamer',async()=>{
  await nav('JOUER');const btn=p.locator('button').filter({hasText:/Avec le chat/i}).first();await btn.click({timeout:5500});await sleep(500);
 },1700);
 await scene('19_jeu_chat_scroll',async()=>{await p.mouse.move(820,430);await p.mouse.wheel(0,380)},1600);
 await scene('20_musee_public',async()=>{await nav('MUS.E')},1400);
 await scene('21_fin',async()=>{await nav('ACCUEIL')},1500);
}finally{
 fs.writeFileSync(OUT+'/chapters.json',JSON.stringify(chapters,null,2));
 const v=p.video();await p.close().catch(()=>{});try{await v.saveAs(OUT+'/anime_game_collection_et_mode_streamer.webm')}catch(e){console.log('VIDERR',e.message)}
 await ctx.close().catch(()=>{});await br.close().catch(()=>{});
 console.log('FINAL',chapters.map(x=>(x.ok?'OK':'ERR')+':'+x.name).join('|'));
}
})().catch(e=>{console.log('FATAL',e.stack);process.exitCode=1});