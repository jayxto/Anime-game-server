import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const SITE = String(process.env.SITE_URL || 'https://anime-game-server.onrender.com').replace(/\/+$/, '');
const CHAR_FILE = path.join(ROOT, 'char-images.json');
const IMG_ROOT = path.join(ROOT, 'assets', 'images', 'chars');
const MANIFEST = path.join(ROOT, 'character-image-manifest.json');
const REPORT = path.join(ROOT, 'CHARACTER_IMAGE_STABLE_REPORT.md');
const UA = 'ANIME-GAME-stable-character-images/6.0';
const WORKERS = Math.max(2, Math.min(Number(process.env.IMAGE_WORKERS || 5), 8));

const ANIME = {
  naruto:'Naruto', onepiece:'One Piece', bleach:'Bleach', hxh:'Hunter x Hunter', hunterxhunter:'Hunter x Hunter',
  snk:'Attack on Titan', aot:'Attack on Titan', attackontitan:'Attack on Titan', nanatsu:'The Seven Deadly Sins', sevendeadlysins:'The Seven Deadly Sins',
  deathnote:'Death Note', cote:'Classroom of the Elite', classroomoftheelite:'Classroom of the Elite', sololeveling:'Solo Leveling',
  blackclover:'Black Clover', clover:'Black Clover', fireforce:'Fire Force', mushokutensei:'Mushoku Tensei: Jobless Reincarnation',
  rezero:'Re:ZERO -Starting Life in Another World-', fairy:'Fairy Tail', fairytail:'Fairy Tail', bluelock:'Blue Lock',
  fma:'Fullmetal Alchemist: Brotherhood', fullmetalalchemist:'Fullmetal Alchemist: Brotherhood', chainsaw:'Chainsaw Man', chainsawman:'Chainsaw Man',
  wakfu:'Wakfu', demonslayer:'Demon Slayer: Kimetsu no Yaiba', kimetsu:'Demon Slayer: Kimetsu no Yaiba', pokemon:'Pokémon',
  dragonball:'Dragon Ball', hellsparadise:"Hell's Paradise", jigokuraku:"Hell's Paradise", gachakuta:'Gachiakuta',
  haikyuu:'Haikyu!!', jujika:'Juujika no Rokunin', jojo:"JoJo's Bizarre Adventure", tensura:'That Time I Got Reincarnated as a Slime',
  onepunchman:'One Punch Man', opm:'One Punch Man', sao:'Sword Art Online', swordartonline:'Sword Art Online',
  tokyoghoul:'Tokyo Ghoul', tokyo_revengers:'Tokyo Revengers', tokyorevengers:'Tokyo Revengers'
};

const FANDOM = {
  naruto:'naruto.fandom.com', onepiece:'onepiece.fandom.com', bleach:'bleach.fandom.com', hxh:'hunterxhunter.fandom.com', hunterxhunter:'hunterxhunter.fandom.com',
  snk:'attackontitan.fandom.com', aot:'attackontitan.fandom.com', attackontitan:'attackontitan.fandom.com', nanatsu:'nanatsu-no-taizai.fandom.com', sevendeadlysins:'nanatsu-no-taizai.fandom.com',
  deathnote:'deathnote.fandom.com', cote:'you-zitsu.fandom.com', classroomoftheelite:'you-zitsu.fandom.com', sololeveling:'solo-leveling.fandom.com',
  blackclover:'blackclover.fandom.com', clover:'blackclover.fandom.com', fireforce:'fire-force.fandom.com', mushokutensei:'mushokutensei.fandom.com',
  rezero:'rezero.fandom.com', fairy:'fairytail.fandom.com', fairytail:'fairytail.fandom.com', bluelock:'bluelock.fandom.com',
  fma:'fma.fandom.com', fullmetalalchemist:'fma.fandom.com', chainsaw:'chainsaw-man.fandom.com', chainsawman:'chainsaw-man.fandom.com',
  wakfu:'wakfu.fandom.com', demonslayer:'kimetsu-no-yaiba.fandom.com', kimetsu:'kimetsu-no-yaiba.fandom.com', pokemon:'pokemon.fandom.com',
  dragonball:'dragonball.fandom.com', hellsparadise:'jigokuraku.fandom.com', jigokuraku:'jigokuraku.fandom.com', gachakuta:'gachiakuta.fandom.com',
  haikyuu:'haikyuu.fandom.com', jojo:'jojo.fandom.com', tensura:'tensura.fandom.com', onepunchman:'onepunchman.fandom.com', opm:'onepunchman.fandom.com',
  sao:'swordartonline.fandom.com', swordartonline:'swordartonline.fandom.com', tokyoghoul:'tokyoghoul.fandom.com', tokyo_revengers:'tokyorevengers.fandom.com', tokyorevengers:'tokyorevengers.fandom.com'
};

const MANUAL_ALIASES = new Map(Object.entries({
  'dragonball|sangoku':'Son Goku','dragonball|sangohan':'Son Gohan','dragonball|sangoten':'Son Goten','dragonball|vegeto':'Vegito',
  'dragonball|roi vegeta':'King Vegeta','dragonball|roi cold':'King Cold','dragonball|grand pretre':'Grand Priest','dragonball|docteur gero':'Dr. Gero',
  'chainsaw|demon des tenebres':'Darkness Devil','chainsaw|demon de la chute':'Falling Devil','chainsaw|demon de la justice':'Justice Devil',
  "chainsaw|demon de l enfer":'Hell Devil',"chainsaw|demon de l'enfer":'Hell Devil','clover|patolli':'Patry',
  'tokyo revengers|draken':'Ken Ryuguji','tokyo_revengers|draken':'Ken Ryuguji','fairy|lector':'Lector'
}));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const compact = s => norm(s).replace(/\s+/g, '');
const slug = s => norm(s).replace(/\s+/g, '-').replace(/^-|-$/g, '') || 'unknown';
const publicPath = p => '/' + path.relative(ROOT, p).split(path.sep).join('/');
const keyFor = (u, n) => compact(u) + '|' + norm(n);
const animeTitle = (u, fallback='') => fallback || ANIME[compact(u)] || String(u || '').replace(/[_-]+/g, ' ');

async function loadJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } }
async function fetchTimed(url, opts={}, timeout=16000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  try {
    return await fetch(url, { ...opts, redirect:'follow', signal:ac.signal, headers:{ 'user-agent':UA, ...(opts.headers || {}) } });
  } finally { clearTimeout(t); }
}

async function validLocal(file) {
  try {
    const st = await fs.stat(file); if (!st.isFile() || st.size < 512) return false;
    const m = await sharp(file, { failOn:'none' }).metadata();
    return Boolean(m.width && m.height);
  } catch { return false; }
}

async function downloadToWebp(url, out) {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  try {
    const r = await fetchTimed(url, { headers:{ accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } }, 18000);
    if (!r.ok) return false;
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.startsWith('image/') && !ct.includes('octet-stream')) return false;
    const ab = await r.arrayBuffer();
    if (ab.byteLength < 800 || ab.byteLength > 18_000_000) return false;
    await fs.mkdir(path.dirname(out), { recursive:true });
    await sharp(Buffer.from(ab), { failOn:'none' }).rotate().resize({ width:480, height:480, fit:'cover', position:'attention', withoutEnlargement:true }).webp({ quality:78, effort:4 }).toFile(out);
    return await validLocal(out);
  } catch { return false; }
}

function scoreName(candidate, wanted) {
  const a = norm(candidate), b = norm(wanted); if (!a || !b) return 0;
  if (a === b) return 100;
  if (compact(a) === compact(b)) return 97;
  const A = new Set(a.split(' ')), B = new Set(b.split(' ')); let common = 0;
  for (const x of A) if (B.has(x)) common++;
  const ratio = common / Math.max(A.size, B.size, 1);
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length,b.length) >= 4) return 82 + Math.round(12 * Math.min(a.length,b.length)/Math.max(a.length,b.length));
  return Math.round(ratio * 82);
}

function scoreAnime(candidate, wanted) {
  const a=norm(candidate), b=norm(wanted); if(!a||!b)return 0;
  if(a===b)return 100; if(a.includes(b)||b.includes(a))return 88;
  return scoreName(a,b);
}

function variants(u, name) {
  const arr=[String(name||'').trim()];
  const alias=MANUAL_ALIASES.get(compact(u)+'|'+norm(name)) || MANUAL_ALIASES.get(norm(u)+'|'+norm(name));
  if(alias) arr.unshift(alias);
  const swapped=String(name||'').split(/\s+/).filter(Boolean); if(swapped.length===2) arr.push(swapped.reverse().join(' '));
  return [...new Set(arr.filter(Boolean))];
}

function findMapped(map,u,name) {
  const b=map?.[u]; if(!b||typeof b!=='object') return '';
  const n=norm(name); for(const [k,v] of Object.entries(b)) if(norm(k)===n && typeof v==='string') return v;
  return '';
}
function setMapped(map,u,name,value) {
  if(!map[u]||typeof map[u]!=='object') map[u]={};
  const n=norm(name); let hit=''; for(const k of Object.keys(map[u])) if(norm(k)===n){hit=k;break}
  map[u][hit || String(name).trim().toLowerCase()] = value;
}

function mergeCatalogue(items) {
  const map=new Map();
  for(const raw of Array.isArray(items)?items:[]) {
    const name=String(raw?.name||'').trim(), u=String(raw?.u||raw?.universe||'').trim(); if(!name||!u) continue;
    const anime=String(raw?.anime||animeTitle(u)).trim(); const img=String(raw?.img||raw?.imageUrl||raw?.originalImg||'').trim();
    const sources=Array.isArray(raw?.sources)?raw.sources:(Array.isArray(raw?.modes)?raw.modes:(raw?.mode?[raw.mode]:[]));
    const k=keyFor(u,name);
    if(!map.has(k)) map.set(k,{u,anime,name,img,sources:[...new Set(sources.map(String))]});
    else { const x=map.get(k); x.sources=[...new Set([...x.sources,...sources.map(String)])]; if(!x.img&&img)x.img=img; }
  }
  return [...map.values()];
}

async function fetchCatalogue(charMap) {
  for(let i=0;i<5;i++) {
    try {
      const r=await fetchTimed(SITE+'/api/character-catalog',{headers:{accept:'application/json'}},30000);
      if(r.ok){const d=await r.json(); if(d?.ok&&Array.isArray(d.characters)&&d.characters.length)return mergeCatalogue(d.characters)}
    } catch {}
    await sleep(5000*(i+1));
  }
  console.log('Live catalogue unavailable: falling back to char-images.json keys');
  const out=[];
  for(const [u,bucket] of Object.entries(charMap||{})) if(bucket&&typeof bucket==='object') for(const [name,img] of Object.entries(bucket)) out.push({u,anime:animeTitle(u),name,img:String(img||''),sources:['char-images']});
  return mergeCatalogue(out);
}

function makeGate(minGap) {
  let chain=Promise.resolve(), next=0;
  return async fn => {
    let release; const previous=chain; chain=new Promise(r=>release=r); await previous.catch(()=>{});
    try { const wait=Math.max(0,next-Date.now()); if(wait)await sleep(wait); const v=await fn(); next=Date.now()+minGap; return v; }
    finally { release(); }
  };
}
const aniGate=makeGate(850), jikanGate=makeGate(430);

async function anilistImage(name,anime,u) {
  const qs=variants(u,name);
  for(const q of qs.slice(0,2)) {
    const query=`query($s:String){Page(page:1,perPage:12){characters(search:$s){name{full native alternative} image{large medium} media(perPage:25){nodes{type title{romaji english native} synonyms}}}}}`;
    try {
      const r=await aniGate(()=>fetchTimed('https://graphql.anilist.co',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({query,variables:{s:q}})},18000));
      if(r.status===429){await sleep(4000);continue} if(!r.ok)continue;
      const cs=(await r.json())?.data?.Page?.characters||[];
      let best=null;
      for(const c of cs) {
        const names=[c?.name?.full,c?.name?.native,...(c?.name?.alternative||[])].filter(Boolean);
        const ns=Math.max(0,...names.flatMap(n=>qs.map(w=>scoreName(n,w)))); if(ns<78)continue;
        const titles=(c?.media?.nodes||[]).filter(m=>!m?.type||m.type==='ANIME').flatMap(m=>[m?.title?.romaji,m?.title?.english,m?.title?.native,...(m?.synonyms||[])]).filter(Boolean);
        const as=titles.length?Math.max(0,...titles.map(t=>scoreAnime(t,anime))):0;
        const score=ns*2+as;
        if(!best||score>best.score)best={score,url:c?.image?.large||c?.image?.medium||''};
      }
      if(best?.url)return best.url;
    } catch {}
  }
  return '';
}

async function fandomImage(u,name) {
  const host=FANDOM[compact(u)]; if(!host)return '';
  const qs=variants(u,name);
  for(const qname of qs.slice(0,2)) {
    const q=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:qname,gsrnamespace:'0',gsrlimit:'8',prop:'pageimages',piprop:'original|thumbnail',pithumbsize:'900',redirects:'1'});
    try {
      const r=await fetchTimed(`https://${host}/api.php?${q}`,{headers:{accept:'application/json'}},18000); if(!r.ok)continue;
      const pages=Object.values((await r.json())?.query?.pages||{});
      pages.sort((a,b)=>Math.max(...qs.map(x=>scoreName(b?.title,x)))-Math.max(...qs.map(x=>scoreName(a?.title,x))));
      for(const p of pages){const sc=Math.max(...qs.map(x=>scoreName(p?.title,x)));const url=p?.original?.source||p?.thumbnail?.source;if(url&&sc>=62)return url}
    } catch {}
  }
  return '';
}

async function jikanImage(name,u) {
  const qs=variants(u,name);
  for(const q of qs.slice(0,2)) {
    try {
      const r=await jikanGate(()=>fetchTimed('https://api.jikan.moe/v4/characters?limit=12&q='+encodeURIComponent(q),{headers:{accept:'application/json'}},18000));
      if(r.status===429){await sleep(2200);continue} if(!r.ok)continue;
      const arr=(await r.json())?.data||[]; let best=null;
      for(const c of arr){const ns=Math.max(...qs.map(x=>scoreName(c?.name,x)));if(ns<78)continue;const url=c?.images?.webp?.image_url||c?.images?.jpg?.image_url;if(url&&(!best||ns>best.s))best={s:ns,url}}
      if(best?.url)return best.url;
    } catch {}
  }
  return '';
}

async function wikipediaImage(name,anime,u) {
  const qs=variants(u,name);
  try {
    const p=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:`${qs[0]} ${anime}`,gsrnamespace:'0',gsrlimit:'6',prop:'pageimages',piprop:'original|thumbnail',pithumbsize:'900'});
    const r=await fetchTimed('https://en.wikipedia.org/w/api.php?'+p,{headers:{accept:'application/json'}},18000); if(!r.ok)return '';
    const pages=Object.values((await r.json())?.query?.pages||{}); let best=null;
    for(const x of pages){const s=Math.max(...qs.map(q=>scoreName(x?.title,q)));const url=x?.original?.source||x?.thumbnail?.source;if(url&&s>=58&&(!best||s>best.s))best={s,url}}
    return best?.url||'';
  } catch { return ''; }
}

let pokeIndexPromise=null;
async function getPokeIndex(){
  if(pokeIndexPromise)return pokeIndexPromise;
  pokeIndexPromise=(async()=>{const m=new Map();try{const r=await fetchTimed('https://pokeapi.co/api/v2/pokemon-species?limit=2000',{headers:{accept:'application/json'}},30000);if(!r.ok)return m;const d=await r.json();for(const row of(d?.results||[])){const id=String(row.url||'').match(/pokemon-species\/(\d+)\/?$/)?.[1];if(id){m.set(norm(row.name),id);m.set(compact(row.name),id)}}}catch{}return m})();
  return pokeIndexPromise;
}
async function pokemonImage(name,u){
  if(compact(u)!=='pokemon')return '';
  const idx=await getPokeIndex();
  for(const v of variants(u,name)){const id=idx.get(norm(v))||idx.get(compact(v));if(id)return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`}
  return '';
}

async function makeFallback(out,name,anime){
  const safe=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const initials=String(name).split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#261238"/></linearGradient></defs><rect width="480" height="480" fill="url(#g)"/><circle cx="240" cy="190" r="110" fill="#202b42"/><text x="240" y="220" text-anchor="middle" font-family="Arial,sans-serif" font-size="92" font-weight="700" fill="#f4f7ff">${safe(initials)}</text><text x="240" y="350" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="700" fill="#fff">${safe(String(name).slice(0,28))}</text><text x="240" y="390" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" fill="#aab4c7">${safe(String(anime).slice(0,34))}</text></svg>`;
  await fs.mkdir(path.dirname(out),{recursive:true}); await sharp(Buffer.from(svg)).webp({quality:80}).toFile(out);
}

async function main(){
  const charMap=await loadJson(CHAR_FILE,{});
  const previous=await loadJson(MANIFEST,{characters:[]});
  const prevByKey=new Map((previous?.characters||[]).map(x=>[keyFor(x.u,x.name),x]));
  const chars=await fetchCatalogue(charMap);
  console.log(`Catalogue unique: ${chars.length} characters • workers=${WORKERS}`);

  const results=new Array(chars.length);
  const counters={stable:0,downloaded:0,existingRemote:0,pokemon:0,anilist:0,fandom:0,jikan:0,wikipedia:0,fallback:0};
  let cursor=0,done=0;

  async function processOne(i){
    const x=chars[i], anime=animeTitle(x.u,x.anime), out=path.join(IMG_ROOT,slug(x.u),slug(x.name)+'.webp'), local=publicPath(out), k=keyFor(x.u,x.name);
    const prev=prevByKey.get(k); const currentValid=await validLocal(out); const wasFallback=prev?.source==='generated-fallback';
    if(currentValid&&!wasFallback){setMapped(charMap,x.u,x.name,local);counters.stable++;results[i]={...x,anime,image:local,source:prev?.source||'local-existing'};return}

    const candidates=[]; const mapped=findMapped(charMap,x.u,x.name);
    if(/^https?:\/\//i.test(mapped))candidates.push(['existing-map',mapped]);
    if(/^https?:\/\//i.test(x.img)&&x.img!==mapped)candidates.push(['catalog',x.img]);
    for(const [label,url] of candidates){if(await downloadToWebp(url,out)){counters.downloaded++;counters.existingRemote++;setMapped(charMap,x.u,x.name,local);results[i]={...x,anime,image:local,source:label};return}}

    const resolvers=[
      ['pokemon',()=>pokemonImage(x.name,x.u)],
      ['anilist',()=>anilistImage(x.name,anime,x.u)],
      ['fandom',()=>fandomImage(x.u,x.name)],
      ['jikan',()=>jikanImage(x.name,x.u)],
      ['wikipedia',()=>wikipediaImage(x.name,anime,x.u)]
    ];
    for(const [label,fn] of resolvers){let url='';try{url=await fn()}catch{}if(url&&await downloadToWebp(url,out)){counters.downloaded++;counters[label]++;setMapped(charMap,x.u,x.name,local);results[i]={...x,anime,image:local,source:label};return}}

    if(!currentValid)await makeFallback(out,x.name,anime);
    counters.fallback++;setMapped(charMap,x.u,x.name,local);results[i]={...x,anime,image:local,source:'generated-fallback'};
  }

  async function worker(){
    while(true){const i=cursor++;if(i>=chars.length)return;await processOne(i);done++;if(done%20===0||done===chars.length)console.log(`${done}/${chars.length} stable=${counters.stable} actual=${counters.downloaded} fallback=${counters.fallback}`)}
  }
  await Promise.all(Array.from({length:Math.min(WORKERS,chars.length)},worker));

  let missingFiles=0;
  for(const x of results){if(!x)continue;const file=path.join(ROOT,String(x.image||'').replace(/^\//,''));if(!await validLocal(file))missingFiles++}
  if(missingFiles)throw new Error(`${missingFiles} local character files are still invalid/missing`);

  const fallbacks=results.filter(x=>x?.source==='generated-fallback').map(x=>({u:x.u,anime:x.anime,name:x.name,image:x.image}));
  const manifest={generatedAt:new Date().toISOString(),site:SITE,total:chars.length,missingFiles,...counters,characters:results,fallbackCharacters:fallbacks};
  await fs.writeFile(CHAR_FILE,JSON.stringify(charMap,null,2)+'\n');
  await fs.writeFile(MANIFEST,JSON.stringify(manifest,null,2)+'\n');
  await fs.writeFile(REPORT,`# Stable character image report\n\n- Characters unique: **${chars.length}**\n- Valid local images kept: **${counters.stable}**\n- Real images downloaded this run: **${counters.downloaded}**\n- Existing remote links rescued: **${counters.existingRemote}**\n- Pokémon/PokeAPI: **${counters.pokemon}**\n- AniList: **${counters.anilist}**\n- Fandom/Wiki: **${counters.fandom}**\n- Jikan/MAL: **${counters.jikan}**\n- Wikipedia: **${counters.wikipedia}**\n- Local visual fallbacks still needing real art: **${counters.fallback}**\n- Broken/missing local files after validation: **${missingFiles}**\n\nEvery catalogue entry now points to a verified local file under \`/assets/images/chars/\`. Admin URL overrides remain in PostgreSQL and keep priority over these baseline files.\n`);
  console.log('DONE',manifest);
}

main().catch(e=>{console.error(e);process.exit(1)});
