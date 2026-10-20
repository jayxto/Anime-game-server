// Filmer le site en ligne lui-même, jamais des images de démonstration inventées.
const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const dest=path.resolve(process.env.CAPTURE_DIR||'captures'),url=process.env.GAME_URL||'https://anime-game-server.onrender.com';
fs.mkdirSync(dest,{recursive:true});
const report={url,startedAt:new Date().toISOString(),scenes:[],errors:[]};
const nap=t=>new Promise(r=>setTimeout(r,t));
let browser,main,ctx;const peers=[];
async function film(name,fn){
 const x={name,ok:false};
 try{await fn();x.ok=true;}catch(e){x.error=String(e.message||e).slice(0,300);report.errors.push(name+': '+x.error);}
 report.scenes.push(x);console.log((x.ok?'OK ':'ERR ')+name+(x.error?' '+x.error:''));
}
async function connect(page,pseudo){
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000});
 await page.locator('a[onclick*="toggleGuestMode"]').click({timeout:20000});
 await page.locator('#guest-pseudo').fill(pseudo);
 await page.locator('#guest-fields button').click();
 await page.locator('#app-root').waitFor({state:'visible',timeout:14000});
 await page.waitForFunction(()=>typeof socket!=='undefined'&&socket.connected,null,{timeout:20000});
}
async function peer(i){
 while(peers.length<=i){
  const c=await browser.newContext({viewport:{width:1280,height:720},ignoreHTTPSErrors:true});
  const p=await c.newPage();await connect(p,'ClipInvite'+(peers.length+2));peers.push({c,p});
 }
 return peers[i].p;
}
async function leave(){
 try{await main.evaluate(()=>{if(typeof leaveRoom==='function')leaveRoom();if(typeof switchTab==='function')switchTab('mode');if(typeof goToMenuSelection==='function')goToMenuSelection();});}catch{}
 for(const g of peers)try{await g.p.evaluate(()=>{if(typeof leaveRoom==='function')leaveRoom();});}catch{}
 await nap(500);
}
async function joinOthers(code,n){
 for(let i=0;i<n-1;i++){
  const p=await peer(i);
  await p.evaluate(roomCode=>{
   if(typeof leaveRoom==='function')leaveRoom();
   currentRoomCode=roomCode;
   socket.emit('join_room',{roomCode,username:getUsername(),mode:'undercover',subMode:'normal'});
  },code);
  await nap(300);
 }
}
async function play(mode,sub,n=2){
 await leave();
 await main.evaluate(([m,s])=>createRoom(m,s),[mode,sub]);
 await main.locator('#waiting-room').waitFor({state:'visible',timeout:13000});
 const code=await main.evaluate(()=>currentRoomCode);if(!code)throw Error('salon absent');
 await joinOthers(code,n);await nap(900);await main.evaluate(()=>startGame());
 await nap(2500);
 const panel=await main.evaluate(()=>{
  return ['gameplay-room','rg-room','enchere-room','enchereaveugle-room','connexion-room','dle-room','quote-room','blindtest-room','arcade-room','draw-room','guess-room','chaine-room','lg-room','uq-room'].filter(id=>{
   const el=document.getElementById(id);return el&&getComputedStyle(el).display!=='none';
  }).join(',');
 });
 console.log('UI '+mode+': '+(panel||'salon attente'));await nap(1300);if(!panel)throw Error('Partie non lancée : écran de salon seulement');
}
async function mini(game){
 await leave();await main.evaluate(g=>g==='tournoi'?createRoom('arcade','tournoi'):openArcadeGame(g),game);await nap(700);
 const roomCode=await main.evaluate(()=>currentRoomCode);
 if(!roomCode){
  await main.evaluate(()=>{
   const buttons=[...document.querySelectorAll('#universe-select-grid .quote-universe-btn')];
   const b=buttons.find(el=>getComputedStyle(el).display!=='none');if(b)b.click();
  });
 }
 await main.locator('#waiting-room').waitFor({state:'visible',timeout:14000});
 const code=await main.evaluate(()=>currentRoomCode);
 await joinOthers(code,2);await nap(700);await main.evaluate(()=>startGame());await nap(3000);if(!(await main.locator('#arcade-room').isVisible()))throw Error('Mini-jeu resté en salon');
}
(async()=>{
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  ctx=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:dest,size:{width:1280,height:720}},ignoreHTTPSErrors:true,locale:'fr-FR'});
  main=await ctx.newPage();
  main.on('pageerror',e=>{if(report.errors.length<80)report.errors.push('JS: '+String(e.message).slice(0,160))});
  await film('Connexion',async()=>{await main.goto(url,{waitUntil:'domcontentloaded',timeout:45000});await main.locator('#auth-screen').waitFor({state:'visible',timeout:13000});await nap(1400);});
  await film('Invité',async()=>{
   await main.locator('a[onclick*="toggleGuestMode"]').click();
   await main.locator('#guest-pseudo').fill('DemoStreamer');
   await main.locator('#guest-fields button').click();
   await main.locator('#app-root').waitFor({state:'visible',timeout:14000});
   await main.waitForFunction(()=>socket.connected,null,{timeout:16000});await nap(1600);
  });
  await film('Tous les modes du catalogue',async()=>{
   for(let y=0;y<4500;y+=340){await main.evaluate(v=>window.scrollTo(0,v),y);await nap(225)}
   await main.evaluate(()=>window.scrollTo(0,0));await nap(600);
  });
  for(const [name,tab] of [['Cartes et collection','collection'],['Amis et communauté','amis'],['Paramètres et options','options']]){
   await film(name,async()=>{await main.evaluate(t=>switchTab(t),tab);await nap(1300);await main.evaluate(()=>window.scrollTo(0,550));await nap(1100);});
  }
  await film('Salons publics',async()=>{await main.evaluate(()=>{switchTab('mode');goToMenuSelection();togglePublicRooms(true)});await nap(2200);await main.evaluate(()=>togglePublicRooms(false));});
  const modes=[
   ['Undercover normal','undercover','normal',3],['Undercover hardcore','undercover','hardcore',3],
   ['Devine la note','note','normal',3],['Blind Test','blindtest','normal',2],
   ['Citations','quote','naruto',2],['Loup-garou','loupgarou','all',4],
   ['Devine le perso','guess','all',2],['Dessine le perso','draw','all',2],
   ['Chaîne de persos','chaine','naruto',2],['AnimeDLE','dle','naruto',2],
   ['Connexion','connexion',null,2],['Rolland Garros','rollandgaros','naruto',2],
   ['Enchères','enchere','naruto',2],['Enchères aveugles','enchereaveugle','naruto',2]
  ];
  for(const [name,mode,sub,n] of modes)await film(name,()=>play(mode,sub,n));
  for(const game of ['pixel','silhouette','attaque','zoom','emoji','quatre','mapguess','fusion','scene','link','popularite','bac','imposteur','audio','chrono','draft','connections','codeanime','ordre','gridchallenge','cardbattle','tournoi']){
   await film('Mini-jeu '+game,()=>mini(game));
  }
  await film('Fin de présentation',async()=>{await leave();await main.evaluate(()=>window.scrollTo(0,0));await nap(1200)});
 }catch(e){report.errors.push('FATAL: '+String(e.stack||e));console.error(e);}
 finally{
  report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(dest,'capture-report.json'),JSON.stringify(report,null,2));
  if(main)await main.close().catch(()=>{});
  if(ctx)await ctx.close().catch(()=>{});
  for(const g of peers){await g.p.close().catch(()=>{});await g.c.close().catch(()=>{})}
  if(browser)await browser.close().catch(()=>{});
  const webms=fs.readdirSync(dest).filter(n=>n.endsWith('.webm'));
  if(webms[0])fs.renameSync(path.join(dest,webms[0]),path.join(dest,'Anime-Game-capture-reelle.webm'));
  console.log('Capture: '+report.scenes.length+' scènes, '+report.errors.length+' erreurs.');
 }
})();
