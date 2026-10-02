import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const SITE = String(process.env.SITE_URL || 'https://anime-game-server.onrender.com').replace(/\/+$/, '');
const CHAR_FILE = path.join(ROOT, 'char-images.json');
const IMG_ROOT = path.join(ROOT, 'assets', 'images', 'chars');
const MANIFEST = path.join(ROOT, 'character-image-manifest.json');
const REPORT = path.join(ROOT, 'CHARACTER_IMAGE_STABLE_REPORT.md');
const UA = 'ANIME-GAME-stable-character-images/7.0';
const WORKERS = Math.max(4, Math.min(Number(process.env.IMAGE_WORKERS || 10), 12));

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
  naruto:'naruto.fandom.com',onepiece:'onepiece.fandom.com',bleach:'bleach.fandom.com',hxh:'hunterxhunter.fandom.com',hunterxhunter:'hunterxhunter.fandom.com',
  snk:'attackontitan.fandom.com',aot:'attackontitan.fandom.com',attackontitan:'attackontitan.fandom.com',nanatsu:'nanatsu-no-taizai.fandom.com',sevendeadlysins:'nanatsu-no-taizai.fandom.com',
  deathnote:'deathnote.fandom.com',cote:'you-zitsu.fandom.com',classroomoftheelite:'you-zitsu.fandom.com',sololeveling:'solo-leveling.fandom.com',
  blackclover:'blackclover.fandom.com',clover:'blackclover.fandom.com',fireforce:'fire-force.fandom.com',mushokutensei:'mushokutensei.fandom.com',
  rezero:'rezero.fandom.com',fairy:'fairytail.fandom.com',fairytail:'fairytail.fandom.com',bluelock:'bluelock.fandom.com',fma:'fma.fandom.com',fullmetalalchemist:'fma.fandom.com',
  chainsaw:'chainsaw-man.fandom.com',chainsawman:'chainsaw-man.fandom.com',wakfu:'wakfu.fandom.com',demonslayer:'kimetsu-no-yaiba.fandom.com',kimetsu:'kimetsu-no-yaiba.fandom.com',pokemon:'pokemon.fandom.com',
  dragonball:'dragonball.fandom.com',hellsparadise:'jigokuraku.fandom.com',jigokuraku:'jigokuraku.fandom.com',gachakuta:'gachiakuta.fandom.com',haikyuu:'haikyuu.fandom.com',
  jojo:'jojo.fandom.com',tensura:'tensura.fandom.com',onepunchman:'onepunchman.fandom.com',opm:'onepunchman.fandom.com',sao:'swordartonline.fandom.com',swordartonline:'swordartonline.fandom.com',
  tokyoghoul:'tokyoghoul.fandom.com',tokyo_revengers:'tokyorevengers.fandom.com',tokyorevengers:'tokyorevengers.fandom.com'
};

const MANUAL_ALIASES = new Map(Object.entries({
  'dragonball|sangoku':'Son Goku','dragonball|sangohan':'Son Gohan','dragonball|sangoten':'Son Goten','dragonball|vegeto':'Vegito',
  'dragonball|roi vegeta':'King Vegeta','dragonball|roi cold':'King Cold','dragonball|grand pretre':'Grand Priest','dragonball|docteur gero':'Dr. Gero',
  'chainsaw|demon des tenebres':'Darkness Devil','chainsaw|demon de la chute':'Falling Devil','chainsaw|demon de la justice':'Justice Devil',
  "chainsaw|demon de l enfer":'Hell Devil',"chainsaw|demon de l'enfer":'Hell Devil','clover|patolli':'Patry',
  'tokyorevengers|draken':'Ken Ryuguji','tokyorevengers|draken':'Ken Ryuguji','fairy|lector':'Lector'
}));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const compact = s => norm(s).replace(/\s+/g,'');
const slug = s => norm(s).replace(/\s+/g,'-').replace(/^-|-$/g,'') || 'unknown';
const keyFor = (u,n) => compact(u) + '|' + norm(n);
const publicPath = p => '/' + path.relative(ROOT,p).split(path.sep).join('/');
const animeTitle = (u,fallback='') => fallback || ANIME[compact(u)] || String(u || '').replace(/[_-]+/g,' ');

async function loadJson(file,fallback){ try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback} }
async function fetchTimed(url,opts={},timeout=10000){
  const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),timeout);
  try{return await fetch(url,{...opts,signal:ac.signal,redirect:'follow',headers:{'user-agent':UA,...(opts.headers||{})}})}finally{clearTimeout(t)}
}
async function validLocal(file){
  try{const st=await fs.stat(file);if(!st.isFile()||st.size<512)return false;const m=await sharp(file,{failOn:'none'}).metadata();return Boolean(m.width&&m.height)}catch{return false}
}
async function downloadToWebp(url,out){
  if(!/^https?:\/\//i.test(String(url||'')))return false;
  try{
    const r=await fetchTimed(url,{headers:{accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}},9000);if(!r.ok)return false;
    const ct=String(r.headers.get('content-type')||'').toLowerCase();if(ct&&!ct.startsWith('image/')&&!ct.includes('octet-stream'))return false;
    const ab=await r.arrayBuffer();if(ab.byteLength<800||ab.byteLength>18_000_000)return false;
    await fs.mkdir(path.dirname(out),{recursive:true});
    await sharp(Buffer.from(ab),{failOn:'none'}).rotate().resize({width:420,height:420,fit:'cover',position:'attention',withoutEnlargement:true}).webp({quality:76,effort:3}).toFile(out);
    return await validLocal(out);
  }catch{return false}
}
function scoreName(candidate,wanted){
  const a=norm(candidate),b=norm(wanted);if(!a||!b)return 0;if(a===b)return 100;if(compact(a)===compact(b))return 98;
  if((a.includes(b)||b.includes(a))&&Math.min(a.length,b.length)>=4)return 88;
  const A=new Set(a.split(' ')),B=new Set(b.split(' '));let common=0;for(const x of A)if(B.has(x))common++;
  return Math.round(common/Math.max(A.size,B.size,1)*82);
}
function variants(u,name){
  const arr=[String(name||'').trim()];const alias=MANUAL_ALIASES.get(compact(u)+'|'+norm(name));if(alias)arr.unshift(alias);
  const parts=String(name||'').trim().split(/\s+/);if(parts.length===2)arr.push(parts[1]+' '+parts[0]);return [...new Set(arr.filter(Boolean))];
}
function findMapped(map,u,name){const b=map?.[u];if(!b||typeof b!=='object')return '';const n=norm(name);for(const[k,v]of Object.entries(b))if(norm(k)===n&&typeof v==='string')return v;return ''}
function setMapped(map,u,name,value){if(!map[u]||typeof map[u]!=='object')map[u]={};const n=norm(name);let hit='';for(const k of Object.keys(map[u]))if(norm(k)===n){hit=k;break}map[u][hit||String(name).trim().toLowerCase()]=value}
function mergeCatalogue(items){
  const m=new Map();for(const raw of Array.isArray(items)?items:[]){const name=String(raw?.name||'').trim(),u=String(raw?.u||raw?.universe||'').trim();if(!name||!u)continue;
    const anime=String(raw?.anime||animeTitle(u)).trim(),img=String(raw?.img||raw?.imageUrl||raw?.originalImg||'').trim();
    const sources=Array.isArray(raw?.sources)?raw.sources:(Array.isArray(raw?.modes)?raw.modes:(raw?.mode?[raw.mode]:[]));const k=keyFor(u,name);
    if(!m.has(k))m.set(k,{u,anime,name,img,sources:[...new Set(sources.map(String))]});else{const x=m.get(k);x.sources=[...new Set([...x.sources,...sources.map(String)])];if(!x.img&&img)x.img=img}}
  return [...m.values()];
}
async function fetchCatalogue(charMap){
  for(let i=0;i<3;i++){try{const r=await fetchTimed(SITE+'/api/character-catalog',{headers:{accept:'application/json'}},20000);if(r.ok){const d=await r.json();if(d?.ok&&Array.isArray(d.characters)&&d.characters.length)return mergeCatalogue(d.characters)}}catch{}await sleep(3000)}
  const out=[];for(const[u,b]of Object.entries(charMap||{}))if(b&&typeof b==='object')for(const[name,img]of Object.entries(b))out.push({u,anime:animeTitle(u),name,img:String(img||''),sources:['char-images']});return mergeCatalogue(out);
}

function gate(minGap){let chain=Promise.resolve(),next=0;return async fn=>{let release;const prev=chain;chain=new Promise(r=>release=r);await prev.catch(()=>{});try{const wait=Math.max(0,next-Date.now());if(wait)await sleep(wait);const v=await fn();next=Date.now()+minGap;return v}finally{release()}}}
const aniGate=gate(500),jikanGate=gate(360);

const aniRosterCache=new Map();
async function aniRoster(u,anime){
  const ck=compact(u);if(aniRosterCache.has(ck))return aniRosterCache.get(ck);
  const p=(async()=>{
    const rows=[];const query=`query($search:String,$page:Int){Media(search:$search,type:ANIME){characters(page:$page,perPage:50,sort:[ROLE,RELEVANCE,ID]){pageInfo{hasNextPage}nodes{name{full native alternative}image{large medium}}}}}`;
    for(let page=1;page<=6;page++){
      try{
        const r=await aniGate(()=>fetchTimed('https://graphql.anilist.co',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({query,variables:{search:anime,page}})},14000));
        if(r.status===429){await sleep(1800);break}if(!r.ok)break;const d=await r.json();const block=d?.data?.Media?.characters;for(const c of(block?.nodes||[])){const url=c?.image?.large||c?.image?.medium;if(url)rows.push({names:[c?.name?.full,c?.name?.native,...(c?.name?.alternative||[])].filter(Boolean),url})}if(!block?.pageInfo?.hasNextPage)break;
      }catch{break}
    }
    return rows;
  })();aniRosterCache.set(ck,p);return p;
}
async function bulkAniUrl(x){
  const roster=await aniRoster(x.u,animeTitle(x.u,x.anime));const qs=variants(x.u,x.name);let best=null;
  for(const row of roster){const s=Math.max(0,...row.names.flatMap(n=>qs.map(q=>scoreName(n,q))));if(s>=88&&(!best||s>best.s))best={s,url:row.url}}
  return best?.url||'';
}

let pokeIndexPromise=null;
async function pokeIndex(){if(pokeIndexPromise)return pokeIndexPromise;pokeIndexPromise=(async()=>{const m=new Map();try{const r=await fetchTimed('https://pokeapi.co/api/v2/pokemon-species?limit=2000',{headers:{accept:'application/json'}},20000);if(!r.ok)return m;const d=await r.json();for(const row of(d?.results||[])){const id=String(row.url||'').match(/pokemon-species\/(\d+)\/?$/)?.[1];if(id){m.set(norm(row.name),id);m.set(compact(row.name),id)}}}catch{}return m})();return pokeIndexPromise}
async function pokemonUrl(x){if(compact(x.u)!=='pokemon')return '';const idx=await pokeIndex();for(const v of variants(x.u,x.name)){const id=idx.get(norm(v))||idx.get(compact(v));if(id)return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`}return ''}

async function fandomUrl(x){
  const host=FANDOM[compact(x.u)];if(!host)return '';const qs=variants(x.u,x.name);const q=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:qs[0],gsrnamespace:'0',gsrlimit:'6',prop:'pageimages',piprop:'original|thumbnail',pithumbsize:'800',redirects:'1'});
  try{const r=await fetchTimed(`https://${host}/api.php?${q}`,{headers:{accept:'application/json'}},5500);if(!r.ok)return '';const pages=Object.values((await r.json())?.query?.pages||{});let best=null;for(const p of pages){const s=Math.max(...qs.map(v=>scoreName(p?.title,v)));const url=p?.original?.source||p?.thumbnail?.source;if(url&&s>=66&&(!best||s>best.s))best={s,url}}return best?.url||''}catch{return ''}
}
async function jikanUrl(x){
  const qs=variants(x.u,x.name);try{const r=await jikanGate(()=>fetchTimed('https://api.jikan.moe/v4/characters?limit=10&q='+encodeURIComponent(qs[0]),{headers:{accept:'application/json'}},6000));if(r.status===429)return '';if(!r.ok)return '';let best=null;for(const c of((await r.json())?.data||[])){const s=Math.max(...qs.map(q=>scoreName(c?.name,q)));const url=c?.images?.webp?.image_url||c?.images?.jpg?.image_url;if(url&&s>=82&&(!best||s>best.s))best={s,url}}return best?.url||''}catch{return ''}
}
async function wikipediaUrl(x){
  const qs=variants(x.u,x.name);try{const p=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:`${qs[0]} ${animeTitle(x.u,x.anime)}`,gsrnamespace:'0',gsrlimit:'5',prop:'pageimages',piprop:'original|thumbnail',pithumbsize:'800'});const r=await fetchTimed('https://en.wikipedia.org/w/api.php?'+p,{headers:{accept:'application/json'}},5500);if(!r.ok)return '';let best=null;for(const row of Object.values((await r.json())?.query?.pages||{})){const s=Math.max(...qs.map(q=>scoreName(row?.title,q)));const url=row?.original?.source||row?.thumbnail?.source;if(url&&s>=62&&(!best||s>best.s))best={s,url}}return best?.url||''}catch{return ''}
}
async function makeFallback(out,name,anime){
  const safe=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));const initials=String(name).split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#261238"/></linearGradient></defs><rect width="420" height="420" fill="url(#g)"/><circle cx="210" cy="160" r="96" fill="#202b42"/><text x="210" y="190" text-anchor="middle" font-family="Arial" font-size="80" font-weight="700" fill="#f4f7ff">${safe(initials)}</text><text x="210" y="312" text-anchor="middle" font-family="Arial" font-size="24" font-weight="700" fill="#fff">${safe(String(name).slice(0,27))}</text><text x="210" y="348" text-anchor="middle" font-family="Arial" font-size="17" fill="#aab4c7">${safe(String(anime).slice(0,32))}</text></svg>`;
  await fs.mkdir(path.dirname(out),{recursive:true});await sharp(Buffer.from(svg)).webp({quality:78}).toFile(out);
}

async function main(){
  const charMap=await loadJson(CHAR_FILE,{}),previous=await loadJson(MANIFEST,{characters:[]});const prevByKey=new Map((previous?.characters||[]).map(x=>[keyFor(x.u,x.name),x]));const chars=await fetchCatalogue(charMap);
  console.log(`Catalogue unique: ${chars.length} characters • workers=${WORKERS}`);
  const results=new Array(chars.length),counters={stable:0,downloaded:0,existingRemote:0,pokemon:0,anilistBulk:0,fandom:0,jikan:0,wikipedia:0,fallback:0};
  const needs=[];
  for(let i=0;i<chars.length;i++){
    const x=chars[i],out=path.join(IMG_ROOT,slug(x.u),slug(x.name)+'.webp'),local=publicPath(out),prev=prevByKey.get(keyFor(x.u,x.name));
    if(await validLocal(out)&&prev?.source!=='generated-fallback'){setMapped(charMap,x.u,x.name,local);counters.stable++;results[i]={...x,image:local,source:prev?.source||'local-existing'}}else needs.push(i);
  }
  console.log(`Already stable: ${counters.stable}; to repair: ${needs.length}`);

  const universes=[...new Map(needs.map(i=>[compact(chars[i].u),chars[i]])).values()].filter(x=>compact(x.u)!=='pokemon');
  let pre=0;for(const x of universes){await aniRoster(x.u,animeTitle(x.u,x.anime));pre++;if(pre%5===0||pre===universes.length)console.log(`AniList rosters ${pre}/${universes.length}`)}

  let cursor=0,done=0;
  async function processIndex(i){
    const x=chars[i],anime=animeTitle(x.u,x.anime),out=path.join(IMG_ROOT,slug(x.u),slug(x.name)+'.webp'),local=publicPath(out),currentValid=await validLocal(out);
    const trySource=async(label,getUrl)=>{let url='';try{url=await getUrl()}catch{}if(url&&await downloadToWebp(url,out)){counters.downloaded++;counters[label]++;setMapped(charMap,x.u,x.name,local);results[i]={...x,anime,image:local,source:label};return true}return false};
    if(await trySource('pokemon',()=>pokemonUrl(x)))return;
    if(await trySource('anilistBulk',()=>bulkAniUrl(x)))return;
    const mapped=findMapped(charMap,x.u,x.name);if(/^https?:\/\//i.test(mapped)&&await downloadToWebp(mapped,out)){counters.downloaded++;counters.existingRemote++;setMapped(charMap,x.u,x.name,local);results[i]={...x,anime,image:local,source:'existing-map'};return}
    if(/^https?:\/\//i.test(x.img)&&x.img!==mapped&&await downloadToWebp(x.img,out)){counters.downloaded++;counters.existingRemote++;setMapped(charMap,x.u,x.name,local);results[i]={...x,anime,image:local,source:'catalog'};return}
    if(await trySource('fandom',()=>fandomUrl(x)))return;
    if(await trySource('jikan',()=>jikanUrl(x)))return;
    if(await trySource('wikipedia',()=>wikipediaUrl(x)))return;
    if(!currentValid)await makeFallback(out,x.name,anime);counters.fallback++;setMapped(charMap,x.u,x.name,local);results[i]={...x,anime,image:local,source:'generated-fallback'};
  }
  async function worker(){while(true){const p=cursor++;if(p>=needs.length)return;await processIndex(needs[p]);done++;if(done%25===0||done===needs.length)console.log(`repair ${done}/${needs.length} actual=${counters.downloaded} fallback=${counters.fallback}`)}}
  await Promise.all(Array.from({length:Math.min(WORKERS,needs.length||1)},worker));

  let missingFiles=0;for(const x of results){if(!x){missingFiles++;continue}const file=path.join(ROOT,String(x.image||'').replace(/^\//,''));if(!await validLocal(file))missingFiles++}if(missingFiles)throw new Error(`${missingFiles} local character files invalid/missing`);
  const fallbacks=results.filter(x=>x?.source==='generated-fallback').map(x=>({u:x.u,anime:x.anime,name:x.name,image:x.image}));
  const manifest={generatedAt:new Date().toISOString(),site:SITE,total:chars.length,missingFiles,...counters,characters:results,fallbackCharacters:fallbacks};
  await fs.writeFile(CHAR_FILE,JSON.stringify(charMap,null,2)+'\n');await fs.writeFile(MANIFEST,JSON.stringify(manifest,null,2)+'\n');
  await fs.writeFile(REPORT,`# Stable character image report\n\n- Characters unique: **${chars.length}**\n- Valid local images kept: **${counters.stable}**\n- Real images downloaded this run: **${counters.downloaded}**\n- Existing remote links rescued: **${counters.existingRemote}**\n- Pokémon/PokeAPI: **${counters.pokemon}**\n- AniList bulk roster: **${counters.anilistBulk}**\n- Fandom/Wiki: **${counters.fandom}**\n- Jikan/MAL: **${counters.jikan}**\n- Wikipedia: **${counters.wikipedia}**\n- Local visual fallbacks still needing real art: **${counters.fallback}**\n- Broken/missing local files after validation: **${missingFiles}**\n\nEvery catalogue entry points to a verified local file under \`/assets/images/chars/\`. Admin URL overrides remain stored in PostgreSQL and keep priority.\n`);
  console.log(`DONE total=${chars.length} stable=${counters.stable} real=${counters.downloaded} fallback=${counters.fallback} missing=${missingFiles}`);
}
main().catch(e=>{console.error(e);process.exit(1)});
