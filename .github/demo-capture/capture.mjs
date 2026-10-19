import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const BASE=process.env.GAME_URL||'https://anime-game-server.onrender.com';
const OUT=process.env.CAPTURE_OUTPUT||'gameplay-output';
fs.mkdirSync(OUT+'/raw',{recursive:true});
fs.mkdirSync(OUT+'/clips',{recursive:true});
const report=[];
const names=[
['pixel','Pixel Anime'],['silhouette','Silhouette'],['attaque','Devine attaque'],['zoom','Zoom extreme'],
['emoji','Emoji Anime'],['quatre','4 images 1 anime'],['mapguess','Map Guess'],['fusion','Fusion Anime'],
['scene','Scene Guessr'],['link','Common Link'],['popularite','Popularity Guess'],['bac','Petit bac anime'],
['imposteur','Imposteur'],['audio','Ecoute la scene'],['chrono','Chrono-quiz'],['draft','Draft 5v5'],
['connections','Anime Connections'],['codeanime','Code Anime'],['ordre','Remets dans ordre'],
['gridchallenge','Grid Challenge']];
const rooms=[
['undercover','normal','Undercover Normal'],['undercover','hardcore','Undercover Hardcore'],
['note','normal','Devine la note'],['blindtest','normal','Blind Test Anime'],
['quote','all','Citations'],['dle','naruto','AnimeDLE'],['chaine','all','Chaine de persos'],
['loupgarou','all','Loup garou anime'],['guess','all','Devine le perso'],
['draw','all','Dessine le perso'],['arcade','tournoi','Tournoi'],
['arcade','cardbattle','Combat de cartes'],
['arcade','partymix:pixel,emoji,quatre~1','Party Mix'],
['rollandgaros','all','Rolland Garos'],['enchere','all','Encheres'],
['enchereaveugle','all','Encheres aveugles']];
const features=[
['Accueil','tab','mode'],['Collection','tab','collection'],
['Amis','tab','amis'],['Profil et options','tab','options'],
['Tier List','fn','openTierSelection'],['Battle openings','fn','openBattleSelection'],
['Tu preferes','fn','openUniverseSelection','tupref'],
['Qui','fn','openQapThemes'],['Quiz des joueurs','fn','openQuizBrowser']];
const specs=[
...features.map(v=>({name:v[0],type:v[1],a:v[2],b:v[3]})),
...names.map(v=>({name:v[1],type:'arcade',a:v[0]})),
...rooms.map(v=>({name:v[2],type:'room',a:v[0],b:v[1]}))];
function slug(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').toLowerCase()}
function pause(n){return new Promise(r=>setTimeout(r,n))}
function ffmpeg(args){let r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8',timeout:140000});if(r.status!==0)throw Error((r.stderr||'ffmpeg failed').slice(-250))}
async function guest(pg,tag){
const res=await pg.goto(BASE,{waitUntil:'domcontentloaded',timeout:100000});
if(!res||res.status()>=400)throw Error('HTTP '+(res&&res.status()));
await pg.locator('#auth-screen').waitFor({timeout:40000});
if(await pg.locator('#auth-screen').isVisible()){
await pg.locator('a').filter({hasText:'Jouer en invité'}).first().click();
await pg.locator('#guest-pseudo').fill(('Capture'+tag).slice(0,20));
await pg.locator('#guest-fields button').click();
}
await pg.waitForFunction(()=>typeof socket!=='undefined'&&socket.connected,{timeout:40000});
await pause(1000);
}
async function helper(browser,code,n){
const ctx=await browser.newContext({viewport:{width:1100,height:720}});
const pg=await ctx.newPage();
try{await guest(pg,'invite'+n);await pg.evaluate(c=>{document.getElementById('join-code-input').value=c;joinRoomByCode()},code);await pause(900);return ctx}
catch(e){await ctx.close();throw e}
}
async function one(browser,spec,i){
const id=String(i+1).padStart(2,'0')+'-'+slug(spec.name);
const ctx=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:OUT+'/raw',size:{width:1280,height:720}},deviceScaleFactor:1});
const pg=await ctx.newPage();
pg.on('dialog',d=>d.dismiss().catch(()=>{}));
let guests=[],code='',state='Non filme',error='',valid=false;
try{
await guest(pg,'host'+i+Date.now().toString(36).slice(-4));
if(spec.type==='tab'){await pg.evaluate(x=>switchTab(x),spec.a);state='Navigation reelle';valid=true}
else if(spec.type==='fn'){await pg.evaluate(x=>{if(typeof window[x.a]!=='function')throw Error('Mode absent: '+x.a);window[x.a](...(x.b?[x.b]:[]))},spec);state='Menu reel';valid=true}
else{
if(spec.type==='arcade'){
await pg.evaluate(x=>openArcadeGame(x),spec.a);
const universe=pg.locator('#universe-select-grid').first();
if(await universe.isVisible().catch(()=>false)){const btn=universe.locator('button').first();if(await btn.count())await btn.click()}
}else await pg.evaluate(x=>createRoom(x.a,x.b),spec);
await pg.waitForFunction(()=>document.getElementById('waiting-room')?.style.display==='block',{timeout:22000});
code=await pg.evaluate(()=>currentRoomCode);
const guestCount=spec.a==='undercover'||spec.a==='loupgarou'?3:1;
for(let j=0;j<guestCount;j++){try{guests.push(await helper(browser,code,i+'-'+j))}catch(e){console.log('Guest refused: '+String(e).slice(0,100))}}
await pause(1500);
if(await pg.locator('#btn-start-game').isVisible())await pg.locator('#btn-start-game').click({timeout:7000}).catch(()=>{});
await pause(3300);
state=await pg.evaluate(()=>{
const ids=['arcade-room','gameplay-room','blindtest-room','quote-room','dle-room','rg-room','guess-room','draw-room','lg-room','chaine-room','enchere-room','enchereaveugle-room','connexion-room','uq-room'];
const game=ids.find(id=>{const e=document.getElementById(id);return e&&getComputedStyle(e).display!=='none'});
return game?'Partie reelle: '+game:'Salon reel (partie non lancee)'});
valid=true;
}
await pg.screenshot({path:OUT+'/'+id+'.png',timeout:12000,animations:'disabled'});
await pause(4600);
}catch(e){error=String(e).slice(0,550);console.log('ERREUR '+spec.name+': '+error)}
finally{
if(code)await pg.evaluate(()=>typeof leaveRoom==='function'&&leaveRoom()).catch(()=>{});
for(const g of guests)await g.close().catch(()=>{});
const vid=pg.video();await ctx.close().catch(()=>{});
if(valid&&vid)try{
const raw=await vid.path();
ffmpeg(['-sseof','-3.6','-i',raw,'-t','3.5','-an','-vf','scale=1280:720,fps=24','-c:v','libx264','-preset','fast','-crf','27','-pix_fmt','yuv420p',OUT+'/clips/'+id+'.mp4']);
}catch(e){error+=' | '+String(e);valid=false}
}
report.push({name:spec.name,type:spec.type,state,captured:valid,error,filename:valid?'clips/'+id+'.mp4':null});
fs.writeFileSync(OUT+'/rapport.json',JSON.stringify({site:BASE,date:new Date().toISOString(),scenes:report},null,2));
console.log((valid?'CAPTURE OK ':'ECHEC ')+spec.name+' => '+state);
}
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{for(let i=0;i<specs.length;i++)await one(browser,specs[i],i)}
finally{await browser.close()}
const ok=report.filter(x=>x.captured);
fs.writeFileSync(OUT+'/list.txt',ok.map(x=>"file '"+path.resolve(OUT,x.filename).replaceAll("'","'\\''")+"'").join('\n')+'\n');
if(ok.length)ffmpeg(['-f','concat','-safe','0','-i',OUT+'/list.txt','-c','copy','-movflags','+faststart',OUT+'/ANIME-GAME-VRAIES-CAPTURES-SANS-VOIX.mp4']);
fs.writeFileSync(OUT+'/BILAN.txt','Source reelle: '+BASE+'\nExtraits obtenus: '+ok.length+'/'+report.length+'\nExtraits de vrais gameplay ouverts: '+ok.filter(x=>x.state.startsWith('Partie reelle')).length+'\nAucune scene inventee. Les salons sont distincts des vraies parties.\n');
if(!ok.length)process.exitCode=1;
