'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {io}=require('socket.io-client');

const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const random=()=>crypto.randomBytes(16).toString('hex');
async function randomPort() {
 const x=net.createServer();
 await new Promise((ok,fail)=>{x.once('error',fail);x.listen(0,'127.0.0.1',ok)});
 const n=x.address().port;await new Promise(ok=>x.close(ok));return n;
}
function waitEvent(socket,name,accept=()=>true,timeout=10000) {
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off(name,on);reject(new Error('Timed out waiting for '+name))},timeout);
  const on=v=>{if(!accept(v))return;clearTimeout(timer);socket.off(name,on);resolve(v)};
  socket.on(name,on);
 });
}
async function waitHTTP(base,child,stderr) {
 for(let i=0;i<150;i++){
  if(child.exitCode!==null)throw new Error('Server exited: '+stderr());
  try{const r=await fetch(base+'/api/music-tracks',{signal:AbortSignal.timeout(1200)});if(r.status===200)return;}catch(_){}
  await sleep(350);
 }
 throw new Error('Server never became ready: '+stderr());
}
async function openGuest(base,pseudo,guestIdentity) {
 const socket=io(base,{autoConnect:false,transports:['websocket'],reconnection:false,timeout:12000,auth:{guest:true,pseudo,guestIdentity}});
 const promise=new Promise((resolve,reject)=>{
  const to=setTimeout(()=>reject(new Error('Socket connect timeout: '+pseudo)),14000);
  socket.once('connect',()=>{clearTimeout(to);resolve(socket)});
  socket.once('connect_error',e=>{clearTimeout(to);reject(e)});
 });
 socket.connect();await promise;return socket;
}
async function json(base,path,method='GET',body=null,token=null){
 const headers={};
 if(body!==null)headers['content-type']='application/json';
 if(token)headers.authorization='Bearer '+token;
 const r=await fetch(base+path,{method,headers,body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 let d;try{d=await r.json()}catch(_){d=null}
 return {status:r.status,data:d};
}
test('Real ephemeral server: APIs, login, authorization, Undercover sockets and guest recovery', {timeout:270000}, async()=>{
 const p=await randomPort(),base='http://127.0.0.1:'+p;
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ag-smoke-'));
 const db=path.join(tmp,'db');
 const env={...process.env,PORT:String(p),DB_DIR:db,AG_IMPORT_URL:'',DATABASE_URL:'',JWT_SECRET:random()+random(),NODE_ENV:'test'};
 const child=cp.spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
 let logs='';const add=x=>{logs+=x.toString();if(logs.length>15000)logs=logs.slice(-15000)};
 child.stdout.on('data',add);child.stderr.on('data',add);
 const sockets=[];
 try{
  await waitHTTP(base,child,()=>logs);
  for(const route of ['/api/music-tracks','/api/site','/api/quote-counts','/api/qap/themes','/api/arcade/openings','/api/mode-universes','/api/warmup']){
   const r=await json(base,route);
   assert.equal(r.status,200,route+' '+JSON.stringify(r.data).slice(0,200));
   assert.equal(r.data?.ok,true,route);
  }
  for(const pth of ['/server.js','/db-backup.js','/restore-backup.js','/.github/audit-transform.cjs']){
   const r=await fetch(base+pth);assert.equal(r.status,404,pth);
  }
  const email='smoke'+Date.now()+'@example.test',pw='verysecure123';
  let reg;
  for(let i=0;i<45;i++){
   reg=await json(base,'/api/register','POST',{pseudo:'Testeur'+(Date.now()%10000000),email,password:pw});
   if(reg.status===200)break;
   if(reg.status!==500)break;
   await sleep(500);
  }
  assert.equal(reg.status,200,'Register failed: '+JSON.stringify(reg.data)+' / '+logs.slice(-1400));
  assert.ok(reg.data?.token);
  const login=await json(base,'/api/login','POST',{email,password:pw});
  assert.equal(login.status,200,'Login');
  assert.ok(login.data.token);
  const who=await json(base,'/api/me','GET',null,login.data.token);
  assert.equal(who.status,200,'Authenticated profile');
  assert.equal(who.data.user.email,email);
  const badName=await json(base,'/api/register','POST',{pseudo:'<img onerror=x>',email:'bad-'+email,password:pw});
  assert.equal(badName.status,400,'Invalid pseudonym should be rejected');
  for(const route of ['/api/dle-import-fandom-profile','/api/character-image-cache']){
   const x=await json(base,route,'POST',{universeKey:'naruto',name:'Naruto Uzumaki',imageUrl:'https://example.org/image.png',fields:{}});
   assert.equal(x.status,403,'Unauthorized catalog write '+route);
  }
  const suffix=Date.now().toString(36).slice(-5),roomCode='T'+suffix.slice(0,3).toUpperCase();
  const a=await openGuest(base,'JoueurA'+suffix,random());sockets.push(a);
  const bName='JoueurB'+suffix,bToken=random();
  const b=await openGuest(base,bName,bToken);sockets.push(b);
  const c=await openGuest(base,'JoueurC'+suffix,random());sockets.push(c);
  let joined=waitEvent(a,'update_room',r=>r.code===roomCode&&r.players.length===1);
  a.emit('join_room',{roomCode,mode:'undercover',subMode:'normal'});await joined;
  joined=waitEvent(a,'update_room',r=>r.code===roomCode&&r.players.length===2);
  b.emit('join_room',{roomCode,mode:'undercover',subMode:'normal'});await joined;
  joined=waitEvent(a,'update_room',r=>r.code===roomCode&&r.players.length===3);
  c.emit('join_room',{roomCode,mode:'undercover',subMode:'normal'});await joined;
  const reveal=waitEvent(a,'launch_reveal',r=>r.code===roomCode);
  a.emit('start_game',roomCode);
  const state=await reveal;
  assert.equal(state.status,'reveal');
  assert.equal(state.players.length,3);
  for(const p of state.players.filter(p=>p.id!==a.id)){
   assert.ok(!p.secretData,'Opponent secret was disclosed');
   assert.equal(p.isImpostor,undefined,'Opponent undercover role was disclosed');
  }
  const attacker=await openGuest(base,bName,random());sockets.push(attacker);
  const rejected=waitEvent(attacker,'rejoin_failed');
  attacker.emit('rejoin_room',{roomCode});await rejected;
  let lobbyReset=false;
  a.once('update_room',()=>{lobbyReset=true});
  b.emit('back_to_menu',roomCode);
  await sleep(250);
  assert.equal(lobbyReset,false,'Non-host reset game!');
  let fakeVote=false;
  a.once('start_voting',()=>{fakeVote=true});
  attacker.emit('force_start_voting',{roomCode});
  await sleep(250);
  assert.equal(fakeVote,false,'Outsider forced voting!');
  b.disconnect();
  await sleep(250);
  const b2=await openGuest(base,bName,bToken);sockets.push(b2);
  const resumed=waitEvent(b2,'resume_gameplay',r=>r.code===roomCode);
  b2.emit('rejoin_room',{roomCode});await resumed;

  // Multiple independent real multiplayer sessions: verify every main game boots.
  async function smokeMode(mode,subMode,event,playerCount=2){
   const id='S'+crypto.randomBytes(2).toString('hex').slice(0,3).toUpperCase();
   const players=[];
   for(let n=0;n<playerCount;n++){
    const p=await openGuest(base,'Smoke'+mode.slice(0,5)+n+crypto.randomBytes(2).toString('hex'),random());
    sockets.push(p);players.push(p);
   }
   let ready=waitEvent(players[0],'update_room',r=>r.code===id&&r.players.length===1);
   players[0].emit('join_room',{roomCode:id,mode,subMode});await ready;
   for(let n=1;n<players.length;n++){
    ready=waitEvent(players[0],'update_room',r=>r.code===id&&r.players.length===n+1);
    players[n].emit('join_room',{roomCode:id,mode,subMode});await ready;
   }
   const launched=waitEvent(players[0],event,()=>true,25000);
   players[0].emit('start_game',id);
   const stage=await launched;
   assert.ok(stage,'No initial state for '+mode);
   return {stage,id,players};
  }
  for(const [mode,sub,event,count] of [
   ['enchere','naruto','enchere_state',2],
   ['enchereaveugle','naruto','enchereaveugle_state',2],
   ['connexion','', 'connexion_state',2],
   ['rollandgaros','naruto','rg_state',2],
   ['quote','naruto','quote_state',1],
   ['dle','naruto','dle_state',1],
   ['blindtest','', 'bt_state',2],
   ['arcade','emoji','arc_state',2]
  ]){
   await smokeMode(mode,sub,event,count);
  }
  const note=await smokeMode('note','','prompt_theme_choice',3);
  const chosen=note.players.find(p=>p.id===note.stage.themeMasterId);
  assert.ok(chosen,'Randomly selected theme master must exist');
  const noteStarted=waitEvent(note.players[0],'launch_reveal',r=>r.code===note.id);
  chosen.emit('submit_custom_theme',{roomCode:note.id,theme:'Personnages intelligents'});
  await noteStarted;

 }finally{
  sockets.forEach(s=>{try{s.disconnect()}catch(_){}});
  child.kill('SIGTERM');
  await Promise.race([new Promise(ok=>child.once('exit',ok)),sleep(7000)]);
  if(child.exitCode===null)child.kill('SIGKILL');
  try{fs.rmSync(tmp,{recursive:true,force:true})}catch(_){}
 }
});
