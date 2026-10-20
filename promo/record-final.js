'use strict';
const {chromium}=require('playwright'),fs=require('fs');
const OUT='promo/final-showcase-output';fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await b.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,locale:'fr-FR',recordVideo:{dir:OUT,size:{width:1280,height:720}}});
const p=await ctx.newPage();p.setDefaultTimeout(7000);
const T=Date.now(),ev=[];
const scene=async (name,fn)=>{
 const start=(Date.now()-T)/1000;
 try{await fn();console.log('SUCCESS',name);ev.push({name,start,end:(Date.now()-T)/1000,ok:true})}
 catch(e){console.log('FAILURE',name,e.message.slice(0,150));ev.push({name,start,end:(Date.now()-T)/1000,ok:false})}
};
async function nav(name){
 const node=p.locator('.ag-dash-nav-btn').filter({hasText:new RegExp(name,'i')}).first();
 await node.click({timeout:5000});await sleep(1150);
}
async function clickEco(name){
 const info=await p.evaluate((name)=>{
  const nodes=[...document.querySelectorAll('*')].filter(e=>{
   const r=e.getBoundingClientRect(),s=getComputedStyle(e);
   if(r.top<95||r.top>225||r.left<210||r.left>1260||r.width<16||r.width>200||r.height>100||s.display==='none'||s.visibility==='hidden')return false;
   const v=(e.innerText||'').replace(/\s+/g,' ').trim();
   return v.length>0&&v.length<=25&&(v.toLocaleLowerCase('fr').endsWith(name.toLocaleLowerCase('fr')));
  });
  nodes.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
  const el=nodes[0];
  if(!el)return null;
  const target=el.closest('button,[role="tab"],[onclick]')||el;
  target.setAttribute('data-promo-click','1');
  return {text:(el.innerText||'').slice(0,45),tag:target.tagName,cls:String(target.className).slice(0,65)};
 },name);
 console.log('ECON_CHOICE',name,JSON.stringify(info));
 if(!info)return false;
 await p.locator('[data-promo-click="1"]').first().click({timeout:5000});
 await p.locator('[data-promo-click="1"]').first().evaluate(e=>e.removeAttribute('data-promo-click')).catch(()=>{});
 return true;
}
async function scroll(y){await p.mouse.move(655,480);await p.mouse.wheel(0,y);await sleep(1000)}
async function snap(name){await p.screenshot({path:OUT+'/'+name+'.png'}).catch(()=>{})}
try{
 await scene('00_Accueil_Anime_Game',async()=>{
  await p.goto('https://anime-game-server.onrender.com/',{waitUntil:'domcontentloaded',timeout:100000});
  await p.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).click();
  await p.locator('#guest-pseudo').fill('GameVideo');
  await p.locator('button[onclick*="playAsGuest"]').click({noWaitAfter:true});
  await p.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:20000});
  await sleep(1800);
  await p.locator('#music-collapse-btn').click().catch(()=>{});
  await snap('00_accueil');await sleep(1700);
 });
 await scene('01_Menu_jeux',async()=>{
   await nav('JOUER'); await sleep(1000);
   await scroll(380);await snap('01_modes');await sleep(1200);
   await scroll(350);await sleep(1100);
   await scroll(-730);await sleep(750);
 });
 await scene('02_Filtres_et_categories',async()=>{
   await nav('JOUER');
   for(const text of ['Avec le chat','Bluff & Undercover','Quiz & mini-jeux','Musique','Dessin & fun']){
    const node=p.locator('button').filter({hasText:text}).first();
    if(await node.isVisible().catch(()=>false)){
      await node.click({timeout:4000});await sleep(1250);await scroll(260);
      console.log('CATEGORY',text);
    }
   }
   await snap('02_categories');
 });
 await scene('03_Cartes_collection',async()=>{
   await nav('COLLECTION'); await sleep(1500);await snap('03_collection_hub');
 });
 for(const [name,screen] of [
 ['Boutique','04_boutique_et_boosters'],['Albums','05_albums_et_classeurs'],['Titres','06_titres'],
 ['Défis','07_defis'],['Pass','08_pass_de_saison'],['Échanges','09_echanges'],
 ['Fusion','10_fusions'],['Clan','11_clans'],['Stats','12_statistiques'],
 ['Deck','13_decks'],['Marché','14_marche'],['Musée','15_musee']
 ]){
   await scene(name,async()=>{
     await nav('COLLECTION');
     const ok=await clickEco(name); if(!ok)throw new Error('Tab not visible');
     await sleep(2200);await snap(screen);
     if(name==='Albums'||name==='Boutique'||name==='Deck'){await scroll(370);await sleep(650);}
   });
 }
 await scene('16_Jeu_Quizz_pixel',async()=>{
   await nav('JOUER');
   const category=p.locator('button').filter({hasText:'Quiz & mini-jeux'}).first();
   if(await category.isVisible().catch(()=>false))await category.click({timeout:5000});
   await sleep(550);
   const expand=p.locator('button').filter({hasText:/Voir tous/}).first();
   if(await expand.isVisible().catch(()=>false))await expand.click().catch(()=>{});
   const pixel=p.locator('[onclick="openArcadeGame(\'pixel\')"]').first();
   if(await pixel.count()){await pixel.scrollIntoViewIfNeeded().catch(()=>{});if(await pixel.isVisible())await pixel.click({timeout:5000}).catch(()=>{});}
   await sleep(3400);await snap('16_pixel');
 });
 await scene('17_Conclusion',async()=>{
   if(await p.locator('.ag-dash-nav-btn').filter({hasText:'ACCUEIL'}).first().isVisible().catch(()=>false))await nav('ACCUEIL');
   await sleep(1900);await snap('17_fin');
 });
}finally{
 fs.writeFileSync(OUT+'/chapitres.json',JSON.stringify(ev,null,2));
 const vid=p.video();await p.close().catch(()=>{});
 try{fs.copyFileSync(await vid.path(),OUT+'/Anime_Game_streamer_showcase.webm');}catch(e){console.log('VIDEO_ERROR',e.message);}
 await ctx.close().catch(()=>{});await b.close().catch(()=>{});
 console.log('FINAL_STATUS',ev.map(e=>(e.ok?'OK ':'NO ')+e.name).join(' / '));
}
})().then(()=>process.exit(0)).catch(e=>{console.error('FATAL',e.stack);process.exit(1)});