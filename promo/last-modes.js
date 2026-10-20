'use strict';
const {chromium}=require('playwright'),fs=require('fs');
const OUT='promo/last-output';fs.mkdirSync(OUT,{recursive:true});const wait=n=>new Promise(r=>setTimeout(r,n)),SITE='https://anime-game-server.onrender.com/';
const modes=[['Code Anime',"openArcadeGame('codeanime')"],['Duel de cartes',"createRoom('arcade','cardbattle')"],['Bingo',"openBingoSetup()"],['Tier List',"openTierSelection()"],['Quiz des joueurs',"openQuizBrowser()"],['Party Mix',"openPartyMixSelection()"]];
const done=[];
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function login(p,n){
 await p.goto(SITE,{waitUntil:'domcontentloaded',timeout:90000});await p.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).first().click({timeout:6000});
 await p.locator('#guest-pseudo').fill(n);await p.locator('button[onclick*="playAsGuest"]').first().click({noWaitAfter:true});
 await p.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:18000});await wait(250);
}
async function clickOn(p,name){return p.evaluate(n=>{const el=[...document.querySelectorAll('button[onclick]')].find(x=>x.getAttribute('onclick')===n&&x.offsetWidth>0);if(!el)return false;el.click();return true;},name)}
async function read(p){return (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,1800)}
async function buttons(p){return p.evaluate(()=>[...document.querySelectorAll('button')].filter(x=>x.offsetWidth>0).map(x=>({txt:(x.innerText||'').replace(/\s+/g,' ').slice(0,75),disabled:x.disabled,id:x.id,onclick:x.getAttribute('onclick')})).slice(0,65))}
async function wizard(p,mode){
 for(let step=0;step<6;step++){
  await wait(300);
  if(await p.locator('#btn-start-game').isVisible().catch(()=>false))return;
  let opts=await buttons(p);console.log('SELECT_OPTIONS',mode,JSON.stringify(opts.slice(0,35)).slice(0,4500));
  let regexes=[];
  if(mode==='Tier List')regexes=[/tier list openings/i,/tier list waifu/i,/créer une tier list/i,/lancer/i];
  else if(mode==='Bingo')regexes=[/^Naruto$/i,/Tous les animes/i,/créer un bingo/i,/lancer le bingo/i,/confirmer/i,/Valider/i];
  else if(mode==='Party Mix')regexes=[/Naruto/i,/Créer mon party mix/i,/confirmer/i,/lancer/i,/valider/i];
  else if(mode==='Quiz des joueurs')regexes=[/Naruto/i,/voir le quiz/i,/Jouer/i,/Créer/i,/Valider/i];
  else regexes=[/^Naruto$/i,/Tous les animes/i,/Créer/i];
  let picked=false;
  for(const re of regexes){
   const o=opts.find(x=>!x.disabled&&re.test(x.txt)&&x.txt.length<65);
   if(o){
    let clicked=await p.evaluate(t=>{let b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').replace(/\s+/g,' ').slice(0,75)===t&&!x.disabled&&x.offsetWidth>0);if(!b)return false;b.click();return true;},o.txt);
    if(clicked){console.log('WIZ',mode,o.txt);picked=true;break}
   }
  }if(!picked)break;
 }
}
for(let k=0;k<modes.length;k++){
 const [name,action]=modes[k], s={name,action,started:false};const people=[];let ctx,page;
 try{
  ctx=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR',recordVideo:{dir:OUT,size:{width:1280,height:720}}});
  page=await ctx.newPage();page.setDefaultTimeout(6500);await login(page,'AGFinal'+k);
  await page.locator('.ag-dash-nav-btn').filter({hasText:/JOUER/}).first().click().catch(()=>{});
  if(name==='Code Anime')await page.locator('.arc-menu-refactor-toggle').click().catch(()=>{});
  const ok=await clickOn(page,action);s.selected=ok;
  if(ok)await wizard(page,name);
  let before=await read(page);s.before=before;s.code=before.match(/#([A-Z0-9]{4,8})/)?.[1];
  if(s.code){
   for(let i=0;i<4;i++){
    try{
     const c=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR'});people.push(c);
     const q=await c.newPage();q.setDefaultTimeout(5000);
     await login(q,'AGFinalGuest'+k+'A'+i);
     await q.locator('#join-code-input').fill(s.code);await clickOn(q,'joinRoomByCode()');await wait(300);
    }catch(e){console.log('JOIN_FAIL',name,i,e.message.slice(0,130))}
   }
  }
  const start=page.locator('#btn-start-game');
  if(await start.isVisible().catch(()=>false)){
   s.buttonDisabled=await start.isDisabled();s.buttonHTML=await start.evaluate(x=>x.outerHTML.slice(0,450));
   if(!s.buttonDisabled)await start.click({noWaitAfter:true,timeout:7000}).catch(e=>console.log('STARTERR',name,e.message.slice(0,100)));
  }
  await wait(1200);s.after=await read(page);s.buttons=await buttons(page);
  s.started=!!s.after && !s.after.includes("Salon d'attente")&&!s.after.includes('JOUER MAINTENANT')&&
   ((name==='Tier List'&&/S\s+A\s+B\s+C|glisser|Déplace|classe|catégorie/i.test(s.after))||(name!=='Tier List'&&(/Manche|Tour |Valider|Question|Carte|Dessiner|Quizz|Bingo|Code|Chef|Indice|Réponse/i.test(s.after))));
  console.log('STATUS',name,'selected',s.selected,'disabled',s.buttonDisabled,'started',s.started,'screen',s.after.slice(0,500));
  await page.screenshot({path:OUT+'/screen_'+String(k).padStart(2,'0')+'.png'}).catch(()=>{});await wait(1350);
 }catch(e){s.error=e.message.slice(0,250);console.log('ERROR',name,s.error);}
 finally{
  if(page){const v=page.video();await page.close().catch(()=>{});await ctx.close().catch(()=>{});s.file='game_'+String(k).padStart(2,'0')+'.webm';if(v)await v.saveAs(OUT+'/'+s.file).catch(()=>{});}
  for(const c of people)await c.close().catch(()=>{});
  done.push(s);fs.writeFileSync(OUT+'/metadata.json',JSON.stringify(done,null,2));
 }
}
await browser.close();console.log('FINISHED',done.length,done.filter(s=>s.started).length);
})().catch(e=>{console.log('FATAL',e.stack);process.exitCode=1});