'use strict';
const {chromium}=require('playwright'),fs=require('fs');
const GROUP=process.env.GROUP||'arcade',OUT='promo/live-'+GROUP;fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),SITE='https://anime-game-server.onrender.com/';
const data={group:GROUP,scenes:[]};
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR',recordVideo:{dir:OUT,size:{width:1280,height:720}}});
const page=await ctx.newPage();page.setDefaultTimeout(6500);
let guests=[];page.on('pageerror',e=>console.log('PAGEERROR',e.message.slice(0,150)));
async function click(p,sel){let a=p.locator(sel).first();if(!await a.isVisible().catch(()=>false))return false;await a.click({timeout:6000,noWaitAfter:true});return true}
async function joinGuest(p,name){
 await p.goto(SITE,{waitUntil:'domcontentloaded',timeout:100000});
 await p.locator('a').filter({hasText:/Play as guest|Jouer en invité/i}).click({timeout:7500});
 await p.locator('#guest-pseudo').fill(name);
 await p.locator('button[onclick*="playAsGuest"]').first().click({noWaitAfter:true});
 await p.locator('.ag-dash-nav-btn').first().waitFor({state:'visible',timeout:16000});
 await sleep(400);
}
async function getBody(p){return (await p.locator('body').innerText().catch(()=>'' )).replace(/\s+/g,' ').slice(0,2000)}
async function reset(p){
 try{
  await click(p,'button[onclick="backToMenu()"]');
  await click(p,'button[onclick="leaveRoom()"]');
  await sleep(250);
  await click(p,'button[onclick="leaveRoom()"]');
  const b=p.locator('.ag-dash-nav-btn').filter({hasText:/JOUER/}).first();
  if(await b.isVisible().catch(()=>false))await b.click({timeout:4500});
  else await click(p,'#btn-mode');
  await sleep(360);
 }catch(e){console.log('RESET_WARN',e.message.slice(0,80))}
}
async function chooseWizard(){
 for(let z=0;z<4;z++){
  await sleep(400);
  if(await page.locator('#btn-start-game').isVisible().catch(()=>false))return true;
  let n=page.locator('.quote-universe-btn').filter({hasText:/^Naruto$/i}).first();
  if(await n.isVisible().catch(()=>false)){await n.click();continue;}
  let options=page.locator('button:visible');
  let picked=false;
  for(const regex of [/Tous les animes mélangés/i,/Naruto/i,/Créer (la |un |le )?(partie|salon|bingo)/i,/^Lancer$/i,/^Confirmer$/i,/^Commencer$/i,/Choisir (ce thème|Naruto)/i,/^Valider$/i]){
   for(let z2=0,n2=Math.min(85,await options.count());z2<n2;z2++){
    const el=options.nth(z2),txt=(await el.innerText().catch(()=>'' )).trim().replace(/\s+/g,' ');
    if(txt.length<65&&regex.test(txt)){await el.click({timeout:3800}).catch(()=>{});picked=true;break;}
   }
   if(picked)break;
  }
  if(!picked)break;
 }
 return await page.locator('#btn-start-game').isVisible().catch(()=>false);
}
async function addGuestPlayers(code){
 let joined=0;
 for(let i=0;i<3;i++){
 try{
  if(!guests[i]){
   const c=await browser.newContext({viewport:{width:1280,height:720},locale:'fr-FR'});
   const q=await c.newPage();q.setDefaultTimeout(4500);await joinGuest(q,'AGDemo'+GROUP+i);
   guests[i]={ctx:c,page:q};
  }
  const q=guests[i].page;await reset(q);
  if(!await q.locator('#join-code-input').isVisible().catch(()=>false))continue;
  await q.locator('#join-code-input').fill(code);
  await click(q,'button[onclick="joinRoomByCode()"]');
  await sleep(400);
  if((await getBody(q)).includes('Salon d'))joined++;
 }catch(e){console.log('GUEST_ERR',e.message.slice(0,100))}
 if(joined>=2)break;
 }
 return joined;
}
async function startMatch(scene){
 let b=await getBody(page);
 scene.room=b.match(/#([A-Z0-9]{4,8})/)?.[1]||null;
 if(await page.locator('#btn-start-game').isVisible().catch(()=>false)){
  // keep generated demo rooms private
  const pub=page.locator('#room-public-checkbox');
  if(await pub.isVisible().catch(()=>false) && await pub.isChecked().catch(()=>false))await pub.uncheck().catch(()=>{});
  await click(page,'#btn-start-game');
  await sleep(950);
  if(await page.locator('#btn-start-game').isVisible().catch(()=>false)&&scene.room){
   scene.guests=await addGuestPlayers(scene.room);
   await click(page,'#btn-start-game');
   await sleep(900);
  }
 }
 let after=await getBody(page);
 scene.started=!(await page.locator('#btn-start-game').isVisible().catch(()=>false)) && !after.includes("Salon d'attente");
 scene.gameText=after.slice(0,850);
 if(scene.started){
  await sleep(1100);
  const inputs=page.locator('input[type=text]:visible,textarea:visible');
  const input=inputs.last();
  if(await input.isVisible().catch(()=>false)){
   let ph=(await input.getAttribute('placeholder').catch(()=>''))||'';
   if(!/chat|code|recherche|invitation/i.test(ph)){await input.fill('Naruto').catch(()=>{});await input.press('Enter').catch(()=>{});}
  }
  for(const sel of ['button[onclick="arcSubmitGuess()"]','button[onclick*="vote("]','button[onclick*="answer("]','button[onclick*="submitAnswer("]','button[onclick*="qapAnswer("]']){
   if(await click(page,sel).catch(()=>false))break;
  }
  await sleep(1700);
 }
 await page.screenshot({path:OUT+'/mode_'+String(data.scenes.length).padStart(2,'0')+'.png'}).catch(()=>{});
 await sleep(950);
}
const classic=[
["Undercover normal","createRoom('undercover', 'normal')"],
["Undercover hardcore","createRoom('undercover', 'hardcore')"],
["Devine la note","createRoom('note', 'normal')"],
["Citations anime","openQuoteUniverseSelection()"],
["Blind Test","createRoom('blindtest','normal')"],
["Blind Test facile","createRoom('blindtest','facile')"],
["Chaîne","openUniverseSelection('chaine')"],
["Loup-Garou","createRoom('loupgarou','all')"],
["Quiz des joueurs","openQuizBrowser()"],
["Devine le personnage","createRoom('guess','all')"],
["Dessin","openUniverseSelection('draw')"],
["Party Mix","openPartyMixSelection()"],
["Duel de cartes","createRoom('arcade','cardbattle')"],
["Bingo","openBingoSetup()"],
["Tournoi","createRoom('arcade','tournoi')"],
["Tier List","openTierSelection()"],
["Battle","openBattleSelection()"],
["Tu préfères","openUniverseSelection('tupref')"],
["Qui a dit ?","openQapThemes()"],
["Roll and Garos","openUniverseSelection('rollandgaros')"],
["Enchères","openUniverseSelection('enchere')"],
["Enchères aveugles","openUniverseSelection('enchereaveugle')"],
["AnimeDLE","openUniverseSelection('dle')"],
["Connexion","createRoom('connexion', null)"]
];
try{
 await joinGuest(page,'AGStreamer'+GROUP);
 await click(page,'#music-collapse-btn');
 await page.screenshot({path:OUT+'/intro.png'});
 let modes;
 if(GROUP==='arcade'){
  await reset(page);
  await click(page,'.arc-menu-refactor-toggle');
  await sleep(450);
  modes=await page.evaluate(()=>[...new Map([...document.querySelectorAll('button[onclick^="openArcadeGame"]')].map(e=>[e.getAttribute('onclick'),[(e.innerText||'').replace(/\s+/g,' ').slice(0,65),e.getAttribute('onclick')]])).values()]);
 }else modes=classic;
 console.log('FOUND_MODES',GROUP,JSON.stringify(modes));
 for(const [name,onclick] of modes){
  let scene={name,onclick,offset:Date.now(),started:false};
  try{
   await reset(page);
   // Some arcade buttons are hidden behind See all
   if(GROUP==='arcade')await click(page,'.arc-menu-refactor-toggle').catch(()=>{});
   const elem=page.locator('button[onclick]').filter({visible:true});
   let found=false;
   for(let j=0,n=Math.min(180,await elem.count());j<n;j++)if((await elem.nth(j).getAttribute('onclick'))===onclick){await elem.nth(j).click({timeout:4900,noWaitAfter:true});found=true;break;}
   if(!found){scene.error='Game not selectable';console.log('UNSELECTABLE',name);}
   else{
    scene.wizardDone=await chooseWizard();
    await startMatch(scene);
   }
  }catch(e){scene.error=e.message.slice(0,150);console.log('MODE_ERROR',name,scene.error);await page.screenshot({path:OUT+'/error_'+String(data.scenes.length).padStart(2,'0')+'.png'}).catch(()=>{});}
  scene.duration=+((Date.now()-scene.offset)/1000).toFixed(1);
  data.scenes.push(scene);fs.writeFileSync(OUT+'/metadata.json',JSON.stringify(data,null,2));
  console.log('DONE_MODE',name,scene.started,scene.duration,scene.error||'',scene.gameText?.slice(0,95));
 }
} finally {
 fs.writeFileSync(OUT+'/metadata.json',JSON.stringify(data,null,2));
 const video=page.video();await page.close().catch(()=>{});
 try{fs.copyFileSync(await video.path(),OUT+'/Anime_Game_'+GROUP+'_live.webm')}catch(e){console.log('VIDEOERROR',e.message)}
 await ctx.close().catch(()=>{});for(const g of guests)await g?.ctx.close().catch(()=>{});
 await browser.close().catch(()=>{});
 console.log('FINISHED',GROUP,data.scenes.length,data.scenes.filter(x=>x.started).length,data.scenes.filter(x=>x.error).length);
}
})().catch(e=>{console.log('FATAL',e.stack);process.exitCode=1});