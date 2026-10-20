'use strict';
const fs=require('fs');
const {chromium}=require('playwright');
const OUT='promo/record-output';
fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SITE='https://anime-game-server.onrender.com/';
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,locale:'fr-FR',recordVideo:{dir:OUT,size:{width:1280,height:720}}});
const page=await ctx.newPage();
page.setDefaultTimeout(5500);
const state={scenes:[],actions:[],pageErrors:[]}; const time0=Date.now();
page.on('pageerror',e=>state.pageErrors.push(e.message.slice(0,180)));
async function scene(name,fn) {
 const start=(Date.now()-time0)/1000;
 try { await fn();console.log('SCENE_OK',name);state.actions.push({name,status:'ok'}); }
 catch(e) {console.log('SCENE_ERROR',name,e.message.slice(0,170));state.actions.push({name,status:'error',msg:e.message.slice(0,150)});}
 state.scenes.push({name,start,end:(Date.now()-time0)/1000});
}
async function visibleButtons() {
 return page.evaluate(()=>[...document.querySelectorAll('button,a,[role="button"],[onclick]')].filter(e=>{let r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'}).map(e=>({text:(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,125),id:e.id,cls:String(e.className||'').slice(0,70),onclick:e.getAttribute('onclick')})).filter(x=>x.text||x.id).slice(0,160));
}
async function inspect(label) {
 const b=await visibleButtons();
 console.log('UI',label,JSON.stringify(b).slice(0,14500));
 const body=await page.evaluate(()=>(document.body.innerText||'').slice(0,2000));
 console.log('BODY',label,body.replace(/\s+/g,' ').slice(0,1200));
 state.actions.push({name:'ui-'+label,buttons:b,body:body.slice(0,2200)});
}
async function clickText(regexp){
 const candidates=page.locator('button,a,[role="button"],[onclick]');
 const n=await candidates.count();
 for(let i=0;i<Math.min(n,350);i++){
  const e=candidates.nth(i);
  let txt=(await e.innerText().catch(()=>'' )).replace(/\s+/g,' ').trim();
  if(txt.length>90||txt.length<1||!regexp.test(txt))continue;
  if(!await e.isVisible().catch(()=>false))continue;
  await e.click({timeout:5000});
  console.log('CLICK',txt.slice(0,80));
  return true;
 }
 return false;
}
async function goHome(){
 await page.keyboard.press('Escape').catch(()=>{});
 const home=await clickText(/^(?:Accueil|Home|Retour au menu|Retour à l'accueil|Menu principal|Main menu)$/i).catch(()=>false);
 if(home){await sleep(1300);return;}
 await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:50000}).catch(()=>{});
 await sleep(2500);
}
try{
 await scene('ACCUEIL',async()=>{
  await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:100000});await sleep(1300);
  await page.screenshot({path:OUT+'/01_accueil.png'});
  await sleep(1200);
 });
 await scene('ENTREE_INVITE',async()=>{
  if(!await page.locator('#guest-pseudo').isVisible().catch(()=>false))
     await page.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).first().click({timeout:4500});
  await page.locator('#guest-pseudo').fill('DemoGame',{timeout:10000});
  await page.locator('button[onclick*="playAsGuest"]').first().click({timeout:7000,noWaitAfter:true});
  await sleep(5000);
  await inspect('guest');
  await page.screenshot({path:OUT+'/02_invite.png'});
  await sleep(2500);
 });
 for(const [name,search] of [
   ['TOUS_LES_MODES',/^(?:Modes de jeu|Game modes|Jouer|Play|Mini.jeux|Games)$/i],
   ['COLLECTION_CARTES',/^(?:Cartes|Cards|Ma collection|Collection|Mes cartes|Inventaire|Album)$/i],
   ['BOOSTERS',/^(?:Booster|Boosters|Packs|Ouvrir un pack|Boutique|Shop)$/i],
   ['BLIND_TEST',/^(?:Blind.?test|Blind test d.openings|Openings)$/i],
   ['UNDERCOVER',/^Undercover/i],
   ['ANIMEDLE',/^AnimeDLE/i],
   ['QUIZ',/^(?:Quiz|Quiz anime|Quiz des joueurs)$/i],
   ['MINI_JEUX',/^(?:Mini.jeux|Mini.games)$/i],
   ['DUEL',/^(?:Duel|Duel 1v1|Classé|Ranked)$/i],
   ['CLANS',/^(?:Clans|Clan)$/i],
   ['CLASSEMENT',/^(?:Classement|Leaderboard|Ranking)$/i],
   ['PROFIL',/^(?:Profil|Profile|Mon profil)$/i],
   ['PASS_SAISON',/^(?:Pass de saison|Season pass|Battle pass)$/i],
   ['BOSS',/^(?:Boss|Boss du serveur|World boss)$/i]
 ]){
   await scene(name,async()=>{
     if(name!=='TOUS_LES_MODES') await goHome();
     let ok=await clickText(search);
     if(!ok) {
       await inspect('missing-'+name);
       await sleep(700);
       return;
     }
     await sleep(2300);
     await page.screenshot({path:OUT+'/'+name.toLowerCase()+'.png'});
     await sleep(1400);
   });
 }
 await scene('FIN',async()=>{
   await goHome();
   await sleep(1700);
   await inspect('final');
 });
} finally {
 fs.writeFileSync(OUT+'/scenes.json',JSON.stringify(state,null,2));
 const v=page.video();
 await page.close().catch(()=>{});
 try { fs.copyFileSync(await v.path(),OUT+'/Anime_Game_real_capture.webm'); }catch(e){console.log('VIDEO_SAVE',e.message);}
 await ctx.close().catch(()=>{});await browser.close().catch(()=>{});
 console.log('COMPLETE',state.scenes.map(s=>s.name).join(', '));
}
})().then(()=>process.exit(0)).catch(e=>{console.error('FATAL',e.stack);process.exit(1);});