'use strict';
const {chromium}=require('playwright'), fs=require('fs');
const OUT='promo/site-content-output';fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR',deviceScaleFactor:1,recordVideo:{dir:OUT,size:{width:1280,height:720}}});
const page=await ctx.newPage();page.setDefaultTimeout(7000);
const T=Date.now(),chapters=[],errors=[];
page.on('pageerror',e=>errors.push(e.message.slice(0,170)));
async function top(){
 await page.mouse.move(580,385);await page.mouse.wheel(0,-3300); await sleep(500);
}
async function inspect(name){
 const info=await page.evaluate(()=>{
  const isVisible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
  const btns=[...document.querySelectorAll('button,a,[role="button"],input,[onclick]')].filter(isVisible).map(e=>({tag:e.tagName,txt:(e.innerText||e.value||'').replace(/\s+/g,' ').trim().slice(0,88),id:e.id,cl:String(e.className||'').slice(0,70),act:e.getAttribute('onclick')||'',placeholder:e.placeholder||''}));
  return{url:location.href,body:(document.body.innerText||'').replace(/\s+/g,' ').trim().slice(0,4200),btns:btns.slice(0,160)};
 });
 fs.writeFileSync(OUT+'/info_'+name+'.json',JSON.stringify(info,null,2));
 console.log('LOOK',name,'BODY',info.body.slice(0,1600));
 console.log('BUTTONS',name,JSON.stringify(info.btns.filter(x=>/stream|twitch|youtube|tiktok|live|OBS|overlay|diffus|boutique|achat|carte|pack|ouvrir|pr.f.renc/i.test(x.txt)||/stream|overlay/i.test(x.act))).slice(0,5000));
 return info;
}
async function screenshot(name){await page.screenshot({path:OUT+'/screen_'+name+'.png'}).catch(()=>{})}
async function section(name,fn,hold=1700){
 const start=(Date.now()-T)/1000;let ok=true,msg='';
 try{await fn();await sleep(hold);}catch(e){ok=false;msg=e.message.slice(0,200);console.log('FAIL',name,msg);}
 await screenshot(name); const i=await inspect(name);chapters.push({name,start,end:(Date.now()-T)/1000,ok,msg,body:i.body.slice(0,1400)});
 fs.writeFileSync(OUT+'/chapters.json',JSON.stringify(chapters,null,2));
 console.log('SCENE',name,ok,((Date.now()-T)/1000-start).toFixed(1));
}
async function nav(label){
 const b=page.locator('.ag-dash-nav-btn').filter({hasText:new RegExp(label,'i')}).first();
 if(!await b.isVisible().catch(()=>false))throw Error('Missing nav '+label);
 await b.click({timeout:5300,noWaitAfter:true});
 await sleep(600);await top();
}
async function collection(name){
 await nav('COLLECTION');
 const r=await page.evaluate((name)=>{
  const ns=[...document.querySelectorAll('*')].filter(e=>{
   const b=e.getBoundingClientRect(),st=getComputedStyle(e);
   if(b.top<95||b.top>235||b.left<210||b.left>1250||b.width<15||b.width>200||b.height>95||st.display==='none'||st.visibility==='hidden')return false;
   let t=(e.innerText||'').trim().replace(/\s+/g,' ');
   return t.length&&t.length<=25&&t.toLowerCase().endsWith(name.toLowerCase());
  }); ns.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
  const el=ns[0];if(!el)return null;const target=el.closest('button,[role="tab"],[onclick]')||el;target.setAttribute('data-demo-target','yes');
  return (el.innerText||'').trim();
 },name);
 if(!r)throw Error('Cannot find internal tab '+name);
 await page.locator('[data-demo-target="yes"]').first().click({timeout:6000});await sleep(500);await top();
}
async function down(n=430){await page.mouse.move(845,450);await page.mouse.wheel(0,n);await sleep(1050)}
async function clickVisibleByRegex(re,cap=70){
 const bs=page.locator('button:visible');const cnt=Math.min(await bs.count(),cap);
 for(let i=0;i<cnt;i++){const e=bs.nth(i);let t=(await e.innerText().catch(()=>'' )).replace(/\s+/g,' ').trim();
 if(t.length<95&&re.test(t)){await e.click({timeout:5000,noWaitAfter:true});return t;}}
 return '';
}
try{
 await section('00_connexion',async()=>{await page.goto('https://anime-game-server.onrender.com/',{waitUntil:'domcontentloaded',timeout:100000});await sleep(750)},700);
 await section('01_hub_general',async()=>{
  await page.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).first().click({timeout:9000});
  await page.locator('#guest-pseudo').fill('DemoStreamerVid');
  await page.locator('button[onclick*="playAsGuest"]').first().click({timeout:9000,noWaitAfter:true});
  await page.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:20000});
  await page.locator('#music-collapse-btn').first().click().catch(()=>{});
 },1900);
 await section('02_collection_cartes',async()=>{await nav('COLLECTION');},2000);
 await section('03_albums',async()=>{await collection('Albums');await down(320);},2000);
 await section('04_album_defilement',async()=>{await down(410)},1300);
 await section('05_boutique_boosters',async()=>{await collection('Boutique');},2500);
 await section('06_boutique_parcourir',async()=>{await down(440)},1500);
 await section('07_echanges_cartes',async()=>{await collection('Échanges')},2000);
 await section('08_fusion_cartes',async()=>{await collection('Fusion')},1800);
 await section('09_decks_tcg',async()=>{await collection('Deck');},2000);
 await section('10_marche',async()=>{await collection('Marché')},1400);
 await section('11_musee',async()=>{await collection('Musée')},1500);
 await section('12_quete_defis',async()=>{await collection('Défis')},1500);
 await section('13_pass_saison',async()=>{await collection('Pass')},1400);
 await section('14_clans',async()=>{await collection('Clan')},1200);
 await section('15_statistiques',async()=>{await collection('Stats')},1300);
 await section('16_titres',async()=>{await collection('Titres')},1300);
 await section('17_classements',async()=>{await nav('CLASSEMENTS')},1700);
 await section('18_quetes',async()=>{await nav('QU.TES')},1600);
 await section('19_amis',async()=>{await nav('AMIS')},1400);
 await section('20_options_parametres',async()=>{await nav('PARAM.TRES')},1700);
 await section('21_parametres_defilement',async()=>{await down(410)},1400);
 await section('22_streamer_option',async()=>{
   await top();let button=await clickVisibleByRegex(/^(?:.*)?(?:mode streamer|streamer|mode live|stream|overlay|int.gration live)(?:.*)?$/i,180);
   console.log('STREAMER_BUTTON',button);
   if(!button){await nav('JOUER');await top();button=await clickVisibleByRegex(/streamer|mode streamer|option.*streamer|overlay/i,180);console.log('STREAMER_FROM_JOUER',button);}
   if(!button)throw Error('streamer configuration not exposed in guest interface');
 },1700);
 await section('23_streamer_ecrans',async()=>{await down(350);},1200);
 await section('24_modes_avec_chat',async()=>{
   if(await page.locator('.ag-dash-nav-btn').filter({hasText:/JOUER/}).first().isVisible().catch(()=>false))await nav('JOUER');
   await clickVisibleByRegex(/Avec le chat/i,130);
 },1700);
 await section('25_options_profil',async()=>{
   if(await page.locator('.ag-dash-profile').first().isVisible().catch(()=>false)){
      await page.locator('.ag-dash-profile').first().click({timeout:5000});
   } else {await nav('ACCUEIL');}
 },1600);
 await section('26_fin',async()=>{if(await page.locator('.ag-dash-nav-btn').filter({hasText:/ACCUEIL/}).first().isVisible().catch(()=>false))await nav('ACCUEIL');},1200);
}finally{
 fs.writeFileSync(OUT+'/chapters.json',JSON.stringify(chapters,null,2));
 fs.writeFileSync(OUT+'/errors.json',JSON.stringify(errors,null,2));
 const v=page.video();await page.close().catch(()=>{});
 try{if(v)await v.saveAs(OUT+'/anime_game_contenu_streamer_sans_audio.webm')}catch(e){console.log('SAVERROR',e.message)}
 await ctx.close().catch(()=>{});await browser.close().catch(()=>{});
 console.log('COMPLETE',chapters.map(c=>(c.ok?'OK:':'FAIL:')+c.name).join(','));
}
})().catch(e=>{console.log('FATAL',e.stack);process.exitCode=1});