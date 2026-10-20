// Enregistrements d'interface RÉELLE, réalisés par Chromium contre le site Anime Game.
// Usage: NODE_PATH=/tmp/ag-capture/node_modules node tests/record-real-gameplay.cjs
// Aucun écran de gameplay n'est simulé. Les modes impossibles à démarrer sont signalés.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.resolve(process.env.CAPTURE_OUT || 'capture-artifacts');
fs.mkdirSync(OUT, {recursive:true});
fs.mkdirSync(path.join(OUT,'screenshots'), {recursive:true});
const BASE = process.env.GAME_URL || 'https://anime-game-server.onrender.com';
const report = {url:BASE,startedAt:new Date().toISOString(),environment:'Live site / Playwright Chromium',modes:[],sections:[],errors:[]};
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60);
let captureIndex=0;
async function visible(page, selector) {
  return page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return s.display!=='none' && s.visibility!=='hidden';}).catch(()=>false);
}
async function shot(page, label) {
  const name=String(++captureIndex).padStart(3,'0')+'-'+slug(label)+'.png';
  await page.screenshot({path:path.join(OUT,'screenshots',name),animations:'disabled',timeout:15000}).catch(e=>report.errors.push({stage:label,error:'screenshot: '+e.message}));
  await sleep(1350);
}
async function guest(page,name) {
  await page.waitForSelector('#auth-screen', {timeout:20000});
  if (await visible(page,'#auth-screen')) {
    await page.locator('a[onclick*="toggleGuestMode"]').click({timeout:12000});
    await page.locator('#guest-pseudo').fill(name);
    await page.locator('#guest-fields button').click();
  }
  await page.waitForFunction(()=>document.getElementById('app-root')?.style.display==='block',{timeout:25000});
  await page.waitForFunction(()=>typeof socket!=='undefined'&&socket.connected,{timeout:30000}).catch(()=>{});
}
async function menu(page) {
  await page.evaluate(()=>{try { if (currentRoomCode) socket.emit('leave_room',{roomCode:currentRoomCode}); } catch(_){} try {goToMenuSelection()}catch(_){} switchTab('mode');});
  await page.waitForTimeout(900);
}
async function showSection(page,label,fn,delay=2200) {
  try { await fn();await sleep(delay);await shot(page,label);report.sections.push({name:label,ok:true});}
  catch(e){report.sections.push({name:label,ok:false,error:e.message});report.errors.push({stage:label,error:e.message});}
}
async function performMode(host,other,name,run){
  const obj={name,kind:'real site',status:'pending'};
  report.modes.push(obj);
  try {
    await menu(host);
    const result = await run();
    if(result==='screen') { obj.status='screen visited (not a multiplayer match)';await shot(host,name);return; }
    await host.waitForTimeout(1800);
    const code=await host.evaluate(()=>currentRoomCode||'');
    if (!code || !await visible(host,'#waiting-room')) {
      const univ=await visible(host,'#quote-universe-selection');
      if(univ) {
        await host.locator('#universe-select-grid .quote-universe-btn:visible').first().click();
        await host.waitForTimeout(1800);
      }
    }
    const roomCode=await host.evaluate(()=>currentRoomCode||'');
    if(!roomCode||!await visible(host,'#waiting-room')) {
      obj.status='entry screen only'; await shot(host,name+'-selection');return;
    }
    await shot(host,name+'-lobby');
    try {
      await other.evaluate((code)=>{currentRoomCode=code;socket.emit('join_room',{roomCode:code,username:getUsername(),mode:'undercover',subMode:'normal'});},roomCode);
      await other.waitForTimeout(1400);
    }catch(e){obj.otherPlayerError=e.message;}
    try {
      await host.evaluate(()=>startGame());
      await host.waitForTimeout(2800);
    } catch(e){obj.startError=e.message;}
    const state=await host.evaluate(()=>({
      lobby:getComputedStyle(document.getElementById('waiting-room')).display,
      gamePanels:[...document.querySelectorAll('#app-root [id$="-room"]')].filter(x=>getComputedStyle(x).display!=='none').map(x=>x.id),
      title:document.getElementById('app-root')?.innerText?.slice(-300)||''
    }));
    obj.status=state.gamePanels.some(p=>p!=='waiting-room') ? 'real gameplay opened':'lobby only — game could not start';
    obj.panels=state.gamePanels;
    await shot(host,name+'-actual');
  }catch(e){obj.status='error';obj.error=e.message;report.errors.push({stage:name,error:e.message});}
  finally {
    const code=await host.evaluate(()=>currentRoomCode||'').catch(()=>'');
    await host.evaluate(()=>{try {socket.emit('leave_room',{roomCode:currentRoomCode});}catch(_){} try{goToMenuSelection()}catch(_){}});
    if(code) await other.evaluate(code=>{try{socket.emit('leave_room',{roomCode:code});}catch(_){} try{goToMenuSelection()}catch(_){}},code).catch(()=>{});
    await host.waitForTimeout(600);
  }
}
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext({viewport:{width:1440,height:810},recordVideo:{dir:path.join(OUT,'videos'),size:{width:1280,height:720}}, reducedMotion:'reduce', ignoreHTTPSErrors:true});
  const guestCtx=await browser.newContext({viewport:{width:1200,height:800}});
  const page=await context.newPage(), other=await guestCtx.newPage();
  page.on('pageerror',e=>report.errors.push({stage:'browser JS',error:e.message.slice(0,300)}));
  page.on('console',msg=>{if(msg.type()==='error'&&report.errors.length<50)report.errors.push({stage:'console',error:msg.text().slice(0,220)});});
  try {
    const r=await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:90000});
    report.httpStatus=r?.status()||null;
    if(!r?.ok())throw Error('Site returned HTTP '+report.httpStatus);
    await shot(page,'01-connexion-reelle');
    await guest(page,'DemoStreamer'+Math.floor(Math.random()*9999));
    await other.goto(BASE,{waitUntil:'domcontentloaded',timeout:90000});
    await guest(other,'DemoInvite'+Math.floor(Math.random()*9999));
    await showSection(page,'02-accueil-vrais-modes',()=>page.evaluate(()=>switchTab('mode')),2500);
    await showSection(page,'03-salons-publics',()=>page.evaluate(()=>togglePublicRooms(true)),1600);
    await showSection(page,'04-collection-cartes',()=>page.evaluate(()=>switchTab('collection')),1800);
    await showSection(page,'05-amis',()=>page.evaluate(()=>switchTab('amis')),1700);
    await showSection(page,'06-options',()=>page.evaluate(()=>switchTab('options')),1500);
    await showSection(page,'07-defis-quetes-du-jour',()=>page.evaluate(()=>switchTab('mode')),1500);
    await menu(page);
    await showSection(page,'08-catalogue-mini-jeux',async()=>{
      const b=page.locator('.arc-menu-refactor-toggle').first();
      if(await b.count()&&await b.isVisible())await b.click();
      await page.locator('.arc-menu').first().scrollIntoViewIfNeeded();
    },1800);
    const arcade=await page.locator('.arc-game-btn[onclick*="openArcadeGame"]').evaluateAll(bs=>bs.map(b=>({title:b.querySelector('b')?.textContent?.trim()||b.textContent.trim(),game:(b.getAttribute('onclick')||'').match(/'([^']+)'/)?.[1]})).filter(x=>x.game));
    report.foundArcade=arcade;
    for(const item of arcade) await performMode(page,other,'Arcade '+item.title,()=>page.evaluate(g=>openArcadeGame(g),item.game));
    const direct=[
      ['Undercover Normal',()=>page.evaluate(()=>createRoom('undercover','normal'))],
      ['Undercover Hardcore',()=>page.evaluate(()=>createRoom('undercover','hardcore'))],
      ['Devine la note',()=>page.evaluate(()=>createRoom('note','normal'))],
      ['Blind Test Anime',()=>page.evaluate(()=>createRoom('blindtest','normal'))],
      ['AnimeDLE',()=>page.evaluate(()=>openUniverseSelection('dle'))],
      ['Citations',()=>page.evaluate(()=>openUniverseSelection('quote'))],
      ['Dessin',()=>page.evaluate(()=>openUniverseSelection('draw'))],
      ['Devine le personnage',()=>page.evaluate(()=>createRoom('guess','all'))],
      ['Rolland Garos',()=>page.evaluate(()=>openUniverseSelection('rollandgaros'))],
      ['Enchere',()=>page.evaluate(()=>openUniverseSelection('enchere'))],
      ['Enchere a aveugle',()=>page.evaluate(()=>openUniverseSelection('enchereaveugle'))],
      ['Jeu de connexion',()=>page.evaluate(()=>createRoom('connexion',null))],
      ['Combat de cartes',()=>page.evaluate(()=>createRoom('arcade','cardbattle'))],
      ['Tournoi',()=>page.evaluate(()=>createRoom('arcade','tournoi'))],
      ['Tier List',async()=>{await page.evaluate(()=>openTierSelection());return 'screen';}],
      ['Battle openings',async()=>{await page.evaluate(()=>openBattleSelection());return 'screen';}],
      ['Party Mix',async()=>{await page.evaluate(()=>openPartyMixSelection());return 'screen';}],
      ['Bingo',async()=>{await page.evaluate(()=>openBingoSetup());return 'screen';}],
      ['Qui',async()=>{await page.evaluate(()=>openQapThemes());return 'screen';}]
    ];
    for(const [name,action] of direct) await performMode(page,other,name,action);
    await menu(page);await shot(page,'fin-presentation-vraie-interface');
  }catch(e){report.errors.push({stage:'fatal',error:e.stack||e.message});}
  finally {
    report.completedAt=new Date().toISOString();
    fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
    const video=page.video();
    await context.close().catch(()=>{});
    await guestCtx.close().catch(()=>{});
    if(video)await video.saveAs(path.join(OUT,'anime-game-vrais-extraits.webm')).catch(e=>console.error(e));
    await browser.close().catch(()=>{});
    console.log('Captured sections:',report.sections.length,'modes:',report.modes.length,'errors:',report.errors.length);
    console.log(JSON.stringify({httpStatus:report.httpStatus,firstErrors:report.errors.slice(0,12),sample:report.modes.slice(0,8)},null,2));
    if(!report.httpStatus||report.httpStatus>=400)process.exitCode=1;
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
