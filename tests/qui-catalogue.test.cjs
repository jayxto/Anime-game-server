const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),server=fs.readFileSync(path.join(root,'server.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const {themes}=require('../content/qui-themes.json'),byId=Object.fromEntries(themes.map(t=>[t.id,t]));
test('catalogue: unique IDs and candidates, playable ballots, local portraits',()=>{
 assert.equal(themes.length,64);assert.equal(new Set(themes.map(t=>t.id)).size,themes.length);
 const media=new Set(['arc','anime','shonen','isekai','transformation','ost','combat']);
 for(const t of themes){assert.ok(t.items.length>=24,t.id);assert.equal(new Set(t.items.map(i=>i.name)).size,t.items.length,t.id);
 for(const i of t.items){assert.ok(i.name&&i.sub,t.id);if(media.has(t.id))continue;for(const u of i.imgs||[i.img]){
 assert.match(u,/^\/assets\/images\//,`${t.id}: ${i.name}`);
 const p=u.replace(/^\/assets\/images\/chars\//,'music/char-images/').replace(/^\//,'');
 // A checkout contains the assets; the isolated test workspace uses a GitHub tree manifest.
 const manifestPath=path.join(root,'..','paths.json');
 if(fs.existsSync(manifestPath)){const manifest=JSON.parse(fs.readFileSync(manifestPath));assert.ok(manifest.some(x=>x.path===p&&x.size>0),p)}else assert.ok(fs.statSync(path.join(root,p)).size>0,p);
 }}}
});
test('family eligibility and nicknames carry explicit context',()=>{
 for(const id of ['bonpere','pirepere','bonnemere','grandfrere','grandesoeur','surnom'])for(const i of byId[id].items)assert.ok(i.note?.length>5,`${id} ${i.name}`);
 const dads=byId.bonpere.items.map(i=>i.name);for(const n of ['Jiraiya','Kakashi Hatake','Piccolo','All Might','Bellemere'])assert.ok(!dads.includes(n));
 assert.ok(byId.bonpere.items.some(i=>i.name==='Son Gohan'&&i.note.includes('Pan')));
 assert.ok(byId.surnom.items.some(i=>i.name==='Minato Namikaze'&&i.note.includes('Éclair')));
});
test('server and every inline JavaScript block parse',()=>{
 new vm.Script(server);let n=0;for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(/src=|application\/ld\+json/.test(m[1])||!m[2].trim())continue;new vm.Script(m[2]);n++;
 }assert.ok(n>30);
});
test('API exposes curated groups, units and notes',()=>{
 const routes={};const fakeFs={readFileSync:(p)=>p.endsWith('qap-themes.json')?JSON.stringify({themes}):'{"themes":[]}'};
 const context={fs:fakeFs,path,__dirname:root,console,app:{get:(p,h)=>routes[p]=h}};vm.createContext(context);
 const a=server.indexOf('const QT_THEMES ='),b=server.indexOf('// Image générique pour les thèmes Battle',a);
 vm.runInContext(server.slice(a,b),context);
 let out;const res={json:x=>out=x,status:()=>res};routes['/api/qap/themes']({query:{}},res);assert.equal(out.themes.length,64);assert.equal(out.themes.find(t=>t.id==='surnom').group,'Aura & style');
 routes['/api/arcade/items']({query:{source:'qt:bonpere'}},res);assert.equal(out.items[0].note,'Père de Naruto');assert.equal(out.unit,'personnages');
});
test('canonical admin portrait takes precedence over the new static portrait',async()=>{
 const routes={};let called;
 const context={console,Map,Date,app:{get:(p,h)=>routes[p]=h},arcItemsFor:()=>byId.bonpere.items,
 resolveImageUniverseKey:()=> 'naruto',simpleManualCharacterImage:async(...args)=>{called=args;return {imageUrl:'/manual-minato.webp'}},
 getCachedCharacterImage:async()=>null};vm.createContext(context);
 const a=server.indexOf('const QAP_ITEM_IMAGE_CACHE ='),b=server.indexOf('// Classement mondial des battles',a);
 vm.runInContext(server.slice(a,b),context);let out;const res={json:x=>out=x,set:()=>res};
 await routes['/api/arcade/item-image']({query:{source:'qt:bonpere',name:'Minato Namikaze'}},res);
 assert.equal(out.imageUrl,'/manual-minato.webp');assert.equal(called[1],'Minato Namikaze');assert.equal(called[2],'Naruto');
});
test('every curated ballot completes with all entrants, including preliminary rounds and undo',()=>{
 const game=html.slice(html.indexOf('        let bb = null;'),html.indexOf('        /* ===================== CHRONO-QUIZ'));
 const context={console,document:{addEventListener(){}},localStorage:{getItem:()=>null},setTimeout:fn=>fn(),Math};vm.createContext(context);
 vm.runInContext(game+'\nbbRenderDuel=()=>{};bbFinish=winner=>{bb.done=true;bb.winner=winner};',context);
 const card={classList:{add(){}}};context.card=card;
 for(const t of themes){context.entrants=t.items;context.source='qt:'+t.id;
 vm.runInContext('bb={all:entrants,source,qt:true};bbStart(entrants.length);',context);
 const initial=vm.runInContext('JSON.stringify(bb.current)',context);
 vm.runInContext('bbPick(0,card,card);bbUndo();',context);assert.equal(vm.runInContext('JSON.stringify(bb.current)',context),initial,t.id);
 vm.runInContext('var guard=0;while(!bb.done&&guard++<entrants.length+2)bbPick(0,card,card);',context);
 assert.equal(vm.runInContext('bb.done',context),true,t.id);assert.equal(vm.runInContext('bb.duels.length',context),t.items.length-1,t.id);
 assert.ok(t.items.some(i=>i.name===vm.runInContext('bb.winner',context)),t.id);
 vm.runInContext('guard=0',context);
 }
});
test('frontend requests the canonical portrait instead of overriding it with static or stale cached URLs',async()=>{
 const code=html.slice(html.indexOf('        const ITEM_IMG_CACHE ='),html.indexOf('        function openSourceSelection('));let calls=0;
 const context={console,localStorage:{getItem:()=>'/stale.webp',setItem(){},removeItem(){}},fetch:async()=>{calls++;return {json:async()=>({imageUrl:'/manual.webp'})}}};vm.createContext(context);vm.runInContext(code,context);
 assert.equal(await vm.runInContext("itemImage('qt:bonpere',{name:'Minato',img:'/static.webp'})",context),'/api/img?u=%2Fmanual.webp');assert.equal(calls,1);
});
test('changing screens cancels stale duel callbacks and undo cannot race the animation',()=>{
 const pending=[];const game=html.slice(html.indexOf('        let bb = null;'),html.indexOf('        /* ===================== CHRONO-QUIZ'));
 const ctx={document:{addEventListener(){}},localStorage:{getItem:()=>null},setTimeout:fn=>pending.push(fn),Math,entrants:byId.bonpere.items,card:{classList:{add(){}}}};vm.createContext(ctx);
 vm.runInContext(game+'\nbbRenderDuel=()=>{};bb={source:"qt:bonpere",qt:true,all:entrants};bbStart(8);bbPick(0,card,card);bbUndo();',ctx);
 assert.equal(vm.runInContext('bb.duels.length',ctx),1,'undo must wait for the current choice animation');
 vm.runInContext('bb=null',ctx);assert.doesNotThrow(()=>pending.shift()());assert.equal(vm.runInContext('bb',ctx),null);
 vm.runInContext('bb={source:"qt:bonpere",qt:true,all:entrants};bbStart(8);bbPick(0,card,card);bb={source:"qt:surnom",qt:true,all:entrants};bbStart(8);',ctx);
 const before=vm.runInContext('JSON.stringify(bb)',ctx);pending.shift()();assert.equal(vm.runInContext('JSON.stringify(bb)',ctx),before);
});
test('world ranking excludes removed candidates without deleting historical votes',async()=>{
 const routes={};const memory=new Map([['qt:bonpere',new Map([['Jiraiya',{wins:99,matches:100,champions:20}],['Minato Namikaze',{wins:5,matches:8,champions:2}]])]]);
 const ctx={app:{get:(p,h)=>routes[p]=h},process:{env:{}},arcItemsFor:()=>byId.bonpere.items,ARC_BATTLE_MEM:memory};vm.createContext(ctx);
 const a=server.indexOf("app.get('/api/battle/ranking'"),b=server.indexOf('// Common Link',a);vm.runInContext(server.slice(a,b),ctx);
 let out;const res={json:x=>out=x,status:()=>res};await routes['/api/battle/ranking']({query:{theme:'qt:bonpere'}},res);
 assert.equal(out.rows.length,1);assert.equal(out.rows[0].name,'Minato Namikaze');assert.equal(memory.get('qt:bonpere').size,2);
});
test('an admin image change is visible even after the previous thematic portrait was cached',async()=>{
 const routes={};let manual=null;
 const ctx={console,Map,Date,app:{get:(p,h)=>routes[p]=h},arcItemsFor:()=>byId.bonpere.items,resolveImageUniverseKey:()=> 'naruto',simpleManualCharacterImage:async()=>manual,getCachedCharacterImage:async()=>null};vm.createContext(ctx);
 const a=server.indexOf('const QAP_ITEM_IMAGE_CACHE ='),b=server.indexOf('// Classement mondial des battles',a);vm.runInContext(server.slice(a,b),ctx);
 let out;const res={json:x=>out=x,set:()=>res};const req={query:{source:'qt:bonpere',name:'Minato Namikaze'}};
 await routes['/api/arcade/item-image'](req,res);assert.equal(out.imageUrl,byId.bonpere.items[0].img);
 manual={imageUrl:'/new-admin.webp'};await routes['/api/arcade/item-image'](req,res);assert.equal(out.imageUrl,'/new-admin.webp');
});
