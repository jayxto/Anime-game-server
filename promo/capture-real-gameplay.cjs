'use strict';
/**
 * Captures the REAL deployed Anime Game in a real Chromium browser.
 * Only anonymous/guest demo players and private temporary rooms are used.
 * No mock screens or synthetic gameplay.
 */
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const URL = process.env.ANIME_GAME_URL || 'https://anime-game-server.onrender.com/';
const OUT = path.resolve('promo/recordings');
fs.mkdirSync(OUT, {recursive:true});
const log = [];
const stamp = Date.now().toString(36).slice(-5);
const sleep = (n) => new Promise(resolve=>setTimeout(resolve,n));
const note=(kind, detail) => {const item={time:new Date().toISOString(),kind,detail};log.push(item);console.log(kind,detail)};
let browser, context, page, otherContext, otherPage;
async function shot(label, hold=1700) {
  await sleep(hold);
  if (!page || page.isClosed()) return;
  const filename = label.replace(/[^a-z0-9_-]/gi,'-').toLowerCase();
  await page.screenshot({path:path.join(OUT,filename+'.png'),animations:'disabled',timeout:20000}).catch(e=>note('screenshot_error',filename+': '+e.message));
  note('shot',filename);
}
async function clickNav(label){
  const ok=await page.evaluate(name=>{
    const el=document.querySelector('.ag-dash-sidebar [data-dash-nav="'+name+'"]') || document.querySelector('[data-dash-nav="'+name+'"]');
    if(el){el.click();return true}return false;
  },label).catch(()=>false);
  note('navigation',label+' '+ok);
  if(ok)await shot('site-'+label,1800);
}
async function doAction(name, js, arg){
  try {await page.evaluate(js,arg);await shot(name,1600);return true}
  catch(e){note('action_error',name+': '+e.message);return false}
}
async function guestLogin(p,pseudo) {
  await p.locator('a[onclick*="toggleGuestMode"]').click({timeout:12000});
  await p.locator('#guest-pseudo').fill(pseudo);
  await p.locator('#guest-fields button').click();
  await p.locator('#app-root').waitFor({state:'visible',timeout:25000});
  await p.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, null, {timeout:25000}).catch(()=>{});
}
async function lobby(mode,submode){
  const good=await doAction('mode-'+mode+'-'+submode,({mode,submode})=>createRoom(mode,submode),{mode,submode});
  if(!good)return;
  await page.locator('#waiting-room').waitFor({state:'visible',timeout:11000}).catch(()=>{});
  await shot('salon-'+mode+'-'+submode,1900);
  // Guest 2 joins ONLY our private room, never another person's public lobby.
  try{
    const code=await page.evaluate(()=>currentRoomCode);
    if(otherPage && code){
      await otherPage.evaluate(code=>{
        currentRoomCode=code;
        socket.emit('join_room',{roomCode:code,username:getUsername(),mode:'undercover',subMode:'normal'});
      },code);
      await sleep(950);
    }
    await page.evaluate(()=>startGame());
    await shot('partie-'+mode+'-'+submode,3100);
    await page.evaluate(()=>leaveRoom());
    if(otherPage) await otherPage.evaluate(()=>leaveRoom()).catch(()=>{});
    await sleep(550);
  }catch(e){note('game_error',mode+': '+e.message);
    await page.evaluate(()=>leaveRoom()).catch(()=>{});
    if(otherPage) await otherPage.evaluate(()=>leaveRoom()).catch(()=>{});
  }
}
async function main(){
  note('source',URL);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  context=await browser.newContext({
    viewport:{width:1280,height:720},deviceScaleFactor:1,
    recordVideo:{dir:OUT,size:{width:1280,height:720}},
    permissions:[],acceptDownloads:false,
  });
  page=await context.newPage();
  page.on('pageerror',e=>note('browser_error',e.message.slice(0,350)));
  page.setDefaultTimeout(12000);
  try {
    const res=await page.goto(URL,{waitUntil:'domcontentloaded',timeout:100000});
    note('http',String(res?.status()));
    await shot('00-connexion',2500);
    if(!(await page.locator('#auth-screen').count()))throw Error('This is not Anime Game authentication page');
    await guestLogin(page,'PromoVideo'+stamp);
    await shot('01-accueil',3600);

    for(const s of ['home','play','collection','shop','deck','trade','clan','friends','leaderboard','quests','museum','settings'])
      await clickNav(s);
    await clickNav('play');
    await page.evaluate(()=>{const e=document.querySelector('#menu-selection');if(e)e.scrollTop=0;window.scrollTo(0,0)}).catch(()=>{});
    await shot('02-liste-modes',1100);

    // Capture REAL mode-selection screens without starting public games.
    const selections=[
      ['pixel',()=>openArcadeGame('pixel')],
      ['silhouette',()=>openArcadeGame('silhouette')],
      ['attaque',()=>openArcadeGame('attaque')],
      ['zoom',()=>openArcadeGame('zoom')],
      ['emoji',()=>openArcadeGame('emoji')],
      ['quatre',()=>openArcadeGame('quatre')],
      ['mapguess',()=>openArcadeGame('mapguess')],
      ['fusion',()=>openArcadeGame('fusion')],
      ['scene',()=>openArcadeGame('scene')],
      ['connections',()=>openArcadeGame('connections')],
      ['codeanime',()=>openArcadeGame('codeanime')],
      ['chrono',()=>openArcadeGame('chrono')],
      ['draft',()=>openArcadeGame('draft')],
      ['tierlist',()=>openTierSelection()],
      ['openings-battle',()=>openBattleSelection()],
      ['tupref',()=>openUniverseSelection('tupref')],
      ['citation',()=>openQuoteUniverseSelection()],
      ['anime-dle',()=>openUniverseSelection('dle')],
      ['bingo',()=>openBingoSetup()],
      ['party-mix',()=>openPartyMixSelection()],
      ['quiz-communaute',()=>openQuizBrowser()]
    ];
    for(const [name,act] of selections){
      await page.evaluate(()=>{if(typeof goToMenuSelection==='function')goToMenuSelection()}).catch(()=>{});
      await doAction('selection-'+name,act);
    }
    await page.evaluate(()=>goToMenuSelection()).catch(()=>{});
    otherContext=await browser.newContext({viewport:{width:1000,height:700}});
    otherPage=await otherContext.newPage();
    await otherPage.goto(URL,{waitUntil:'domcontentloaded',timeout:100000});
    await guestLogin(otherPage,'PromoAmi'+stamp);
    await lobby('undercover','normal');
    await lobby('undercover','hardcore');
    await lobby('note','normal');
    await lobby('blindtest','normal');
    await lobby('arcade','pixel');
    await lobby('arcade','emoji');
    await lobby('arcade','cardbattle');
    await lobby('connexion',null);
    await lobby('guess','all');
    await lobby('arcade','tournoi');
    await clickNav('home');
    await shot('final-le-jeu-reel',2200);
    note('result','complete');
  } catch(e) {
    note('fatal',String(e.stack||e));
    if(page&&!page.isClosed())await shot('erreur-de-capture',500);
    process.exitCode=1;
  } finally {
    if(otherContext)await otherContext.close().catch(()=>{});
    let raw;
    if(page && page.video())raw=page.video();
    if(context)await context.close().catch(()=>{});
    if(raw){
      try{
        const filename=await raw.path();
        const output=path.join(OUT,'anime-game-vrai-gameplay-sans-voix.mp4');
        execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',filename,'-an','-c:v','libx264','-preset','fast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',output],{timeout:240000,stdio:'pipe'});
        note('video',output+' '+fs.statSync(output).size+' bytes');
      }catch(e){note('conversion_error',String(e.message));}
    }
    fs.writeFileSync(path.join(OUT,'rapport.json'),JSON.stringify(log,null,2));
    const shots=log.filter(x=>x.kind==='shot').length;
    console.log('Capture report: '+shots+' real site screenshots');
    if(browser)await browser.close().catch(()=>{});
  }
}
main();