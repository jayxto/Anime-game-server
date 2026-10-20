'use strict';
const {chromium}=require('playwright'),fs=require('fs');
const OUT='promo/blocked-output';fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),SITE='https://anime-game-server.onrender.com/';
const cases=[
 ['Code Anime',"openArcadeGame('codeanime')"],
 ['Undercover hardcore',"createRoom('undercover', 'hardcore')"],
 ['Devine la note',"createRoom('note', 'normal')"],
 ['Loup-Garou',"createRoom('loupgarou','all')"],
 ['Dessin',"openUniverseSelection('draw')"],
 ['Duel de cartes',"createRoom('arcade','cardbattle')"],
 ['Enchères aveugles',"openUniverseSelection('enchereaveugle')"],
 ['Connexion',"createRoom('connexion', null)"],
 ['Bingo',"openBingoSetup()"],
 ['Tier List',"openTierSelection()"],
 ['Quiz des joueurs',"openQuizBrowser()"],
 ['Party Mix',"openPartyMixSelection()"],
 ['Enchères',"openUniverseSelection('enchere')"]
];
const results=[];
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 let browserCtx;
 async function sign(page,name){
 await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).first().click({timeout:7000});
 await page.locator('#guest-pseudo').fill(name);
 await page.locator('button[onclick*="playAsGuest"]').first().click({noWaitAfter:true,timeout:6000});
 await page.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:16000});await sleep(250);
 }
 async function body(p){return (await p.locator('body').innerText().catch(()=>'' )).replace(/\s+/g,' ').slice(0,1600)}
 async function clickOn(p,code){return p.evaluate(s=>{const x=[...document.querySelectorAll('button[onclick]')].find(el=>el.getAttribute('onclick')===s&&el.offsetWidth>0);if(!x)return false;x.click();return true;},code)}
 async function wizard(p){
  for(let i=0;i<5;i++){
   await sleep(350);
   if(await p.locator('#btn-start-game').isVisible().catch(()=>false))return true;
   const next=await p.evaluate(()=>{
    const bs=[...document.querySelectorAll('button')].filter(el=>el.offsetWidth>0);
    for(const regex of [/^Naruto$/i,/Tous les animes mélangés/i,/^Classique$/i,/^Mélangé$/i,/Confirmer/i,/Créer.*partie/i,/Valider/i,/Suivant/i,/Commencer/i,/Créer.*bingo/i,/Lancer/i]){
      const b=bs.find(el=>(el.innerText||'').trim().length<55&&regex.test((el.innerText||'').trim()));
      if(b){b.click();return (b.innerText||'').trim().slice(0,70);}
    }return null;
   });
   console.log('WIZARD',next);
   if(!next)break;
  }
  return await p.locator('#btn-start-game').isVisible().catch(()=>false);
 }
 for(let k=0;k<cases.length;k++){
  const [name,action]=cases[k];let main,ctx;const others=[];const startedAt=Date.now();
  const s={name,action,success:false,joinCount:0};
  try{
   ctx=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR',recordVideo:{dir:OUT,size:{width:1280,height:720}}});
   main=await ctx.newPage();main.setDefaultTimeout(5500);
   await sign(main,'AGMultiHost'+k);
   await main.locator('.ag-dash-nav-btn').filter({hasText:/JOUER/}).first().click().catch(()=>{});
   const started=await clickOn(main,action);
   if(!started){s.error='Mode unavailable';continue;}
   s.wizard=await wizard(main);
   const firstBody=await body(main);s.room=firstBody.match(/#([A-Z0-9]{4,8})/)?.[1]||'';
   console.log('ROOM',name,s.room,firstBody.slice(0,180));
   if(s.room){
    const pub=main.locator('#room-public-checkbox');
    if(await pub.isVisible().catch(()=>false)&&await pub.isChecked().catch(()=>false))await pub.uncheck().catch(()=>{});
    for(let t=0;t<4;t++){
     try{
      let secondCtx=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR'});
      let q=await secondCtx.newPage();q.setDefaultTimeout(4500);
      others.push(secondCtx);
      await sign(q,'AGExtra'+k+'X'+t);
      await q.locator('#join-code-input').fill(s.room);
      await clickOn(q,'joinRoomByCode()');
      await sleep(400);
      const qBody=await body(q);
      if(qBody.includes('Salon d’attente')||qBody.includes("Salon d'attente"))s.joinCount++;
      console.log('JOIN',name,t,qBody.slice(0,115));
     }catch(e){console.log('JOIN_ERR',name,t,e.message.slice(0,95))}
    }
   }
   if(await main.locator('#btn-start-game').isVisible().catch(()=>false)){await main.locator('#btn-start-game').click({noWaitAfter:true});await sleep(1250);}
   let after=await body(main);s.gameText=after.slice(0,1000);
   s.success=!after.includes("Salon d'attente")&&!after.includes('Salon d’attente')&&(!after.includes('JOUER MAINTENANT'))&&(after.includes('Manche')||after.includes('Tour ')||after.includes('Valider')||after.includes('Question')||after.includes('Équipe')||after.includes('Phase')||after.includes('C’est au tour')||after.includes("C'est au tour")||after.includes('Bingo')||after.includes('Tier List')||after.includes('Carte'));
   console.log('GAME',name,s.success,s.joinCount,s.gameText.slice(0,300));
   if(s.success){
    await sleep(1900);
    const inp=main.locator('input[type="text"]:visible,textarea:visible').last();
    if(await inp.isVisible().catch(()=>false)){
      let ph=await inp.getAttribute('placeholder').catch(()=>'');
      if(!/chat|code|search|recherche/i.test(ph||'')){await inp.fill('Naruto').catch(()=>{});await inp.press('Enter').catch(()=>{});}
    }
    await sleep(1500);
   }
   await main.screenshot({path:OUT+'/screen_'+String(k).padStart(2,'0')+'.png'}).catch(()=>{});
   await sleep(950);
  }catch(e){s.error=e.message.slice(0,190);console.log('FAIL',name,s.error);}
  finally{
   s.elapsed=+((Date.now()-startedAt)/1000).toFixed(1);
   if(main){
    try{const v=main.video();await main.close().catch(()=>{});await ctx.close().catch(()=>{});s.file='game_'+String(k).padStart(2,'0')+'.webm';if(v)await v.saveAs(OUT+'/'+s.file);}catch(e){s.saveError=e.message.slice(0,90);}
   }
   for(const g of others){await g.close().catch(()=>{});}
   results.push(s);fs.writeFileSync(OUT+'/metadata.json',JSON.stringify(results,null,2));
   console.log('CASE_DONE',name,s.success,s.joinCount,s.elapsed,s.error||'');
  }
 }
 await browser.close();
 console.log('FINISHED',results.length,results.filter(x=>x.success).length);
})().catch(e=>{console.log('FATAL',e.stack);process.exitCode=1});