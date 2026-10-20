'use strict';
const fs=require('fs');
const {chromium}=require('playwright');
const OUT='promo/showcase-output';
fs.mkdirSync(OUT,{recursive:true});
const SITE='https://anime-game-server.onrender.com/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const ctx=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,locale:'fr-FR',recordVideo:{dir:OUT,size:{width:1280,height:720}}});
 const page=await ctx.newPage();
 page.setDefaultTimeout(7500);
 const T=Date.now();const events=[];
 page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,160)));
 const navname=async name=>{
   let b=page.locator('.ag-dash-nav-btn').filter({hasText:new RegExp(name,'i')}).first();
   if(!await b.isVisible().catch(()=>false))throw new Error('Navigation unavailable: '+name);
   await b.click({timeout:5000});await sleep(1200);
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'})).catch(()=>{});
 };
 const tryButton=async (selector)=>{
   const b=page.locator(selector).first();
   if(!await b.isVisible().catch(()=>false))return false;
   await b.click({timeout:4500});
   return true;
 };
 const wheel=async (amount=500)=>{await page.mouse.move(1090,505);await page.mouse.wheel(0,amount);await sleep(1050)};
 const scene=async(name,fn)=>{
   const start=(Date.now()-T)/1000;
   try{await fn();console.log('OK',name);events.push({name,start,end:(Date.now()-T)/1000,ok:true});}
   catch(e){console.log('FAIL',name,e.message.slice(0,180));events.push({name,start,end:(Date.now()-T)/1000,ok:false,msg:e.message.slice(0,120)});}
 };
 try{
   await scene('00_SITE_OFFICIEL',async()=>{
     await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:100000});
     await sleep(1300);
   });
   await scene('01_ENTREE_EN_INVITE',async()=>{
     await page.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).first().click({timeout:6000});
     await page.locator('#guest-pseudo').fill('AnimeDemo',{timeout:5000});
     await page.locator('button[onclick*="playAsGuest"]').first().click({timeout:6000,noWaitAfter:true});
     await page.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:20000});
     await sleep(2200);
     if(await page.locator('#music-collapse-btn').isVisible().catch(()=>false))await page.locator('#music-collapse-btn').click().catch(()=>{});
     await page.screenshot({path:OUT+'/01_tableau_de_bord.png'});
   });
   await scene('02_ACCUEIL_ET_EVENEMENTS',async()=>{
     await navname('ACCUEIL');
     await sleep(1600);
     await wheel(430);await sleep(1100);
     await wheel(520);await sleep(1200);
     await page.screenshot({path:OUT+'/02_evenements.png'});
     await navname('ACCUEIL');
   });
   await scene('03_TOUS_LES_MODES',async()=>{
     await navname('JOUER');
     await sleep(2100);
     await page.screenshot({path:OUT+'/03_modes_de_jeu.png'});
     await wheel(470);await sleep(1000);
     await wheel(500);await sleep(1100);
     await wheel(440);await sleep(950);
   });
   await scene('04_COLLECTION_DE_CARTES',async()=>{
     await navname('COLLECTION');
     await sleep(2400);
     await page.screenshot({path:OUT+'/04_collection.png'});
     await wheel(520); await sleep(1250);
   });
   await scene('05_BOUTIQUE_BOOSTERS',async()=>{
     await navname('BOUTIQUE');
     await sleep(2300);
     await page.screenshot({path:OUT+'/05_boutique.png'});
     await wheel(470);await sleep(1100);
     await wheel(500);await sleep(1050);
   });
   await scene('06_DECK_BUILDING',async()=>{
     await navname('DECKS');await sleep(2550);
     await page.screenshot({path:OUT+'/06_decks.png'});
   });
   await scene('07_ECHANGES',async()=>{
     await navname('CHANGES');await sleep(2100);
     await page.screenshot({path:OUT+'/07_echanges.png'});
   });
   await scene('08_CLANS',async()=>{
     await navname('CLANS');await sleep(2150);
     await page.screenshot({path:OUT+'/08_clans.png'});
   });
   await scene('09_CLASSEMENTS',async()=>{
     await navname('CLASSEMENTS');await sleep(2100);
     await page.screenshot({path:OUT+'/09_classements.png'});
     await wheel(440);await sleep(750);
   });
   await scene('10_QUETES',async()=>{
     await navname('QU.TES');await sleep(1800);
     await page.screenshot({path:OUT+'/10_quetes.png'});
   });
   await scene('11_MUSEE',async()=>{
     await navname('MUS.E');await sleep(2000);
     await page.screenshot({path:OUT+'/11_musee.png'});
   });
   await scene('12_CATEGORIES_DE_JEUX',async()=>{
     await navname('JOUER');
     await wheel(500);
     const selectors=['button:has-text("Bluff & Undercover")','button:has-text("Quiz & mini-jeux")','button:has-text("Musique")','button:has-text("Avec le chat")'];
     for(const s of selectors){ if(await tryButton(s).catch(()=>false)){await sleep(1350);await wheel(230);await sleep(500);} }
     await page.screenshot({path:OUT+'/12_categories.png'});
   });
   await scene('13_PARTIE_ARCADE_PIXEL',async()=>{
     await navname('JOUER');
     const b=page.locator('[onclick="openArcadeGame(\'pixel\')"]').first();
     if(!await b.count()){console.log('UNAVAILABLE_PIXEL');return;}
     await b.scrollIntoViewIfNeeded().catch(()=>{});
     if(await b.isVisible()){await b.click({timeout:5000}); await sleep(4000);}
     await page.screenshot({path:OUT+'/13_arcade_pixel.png'});
   });
   await scene('14_FIN_ET_LIEN',async()=>{
     if(await page.locator('.ag-dash-nav-btn').filter({hasText:/ACCUEIL/}).first().isVisible().catch(()=>false)) await navname('ACCUEIL');
     else await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
     await sleep(2800);
     await page.screenshot({path:OUT+'/14_fin.png'});
   });
 } finally {
   fs.writeFileSync(OUT+'/scenes.json',JSON.stringify(events,null,2));
   const video=page.video();await page.close().catch(()=>{});
   try{fs.copyFileSync(await video.path(),OUT+'/Anime_Game_streamer_raw.webm');}catch(e){console.log('COPY',e.message);}
   await ctx.close().catch(()=>{});await browser.close().catch(()=>{});
   console.log('DONE',events.map(e=>(e.ok?'OK:':'ERR:')+e.name).join(' | '));
 }
})().then(()=>process.exit(0)).catch(e=>{console.error('FATAL',e.stack);process.exit(1);});