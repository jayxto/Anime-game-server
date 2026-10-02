import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';

const ROOT = process.cwd();
const SITE = String(process.env.SITE_URL || 'https://anime-game-server.onrender.com').replace(/\/+$/,'');
const CHAR_FILE = path.join(ROOT, 'char-images.json');
const SERVER_FILE = path.join(ROOT, 'server.js');
const IMG_ROOT = path.join(ROOT, 'assets', 'images', 'chars');
const MANIFEST = path.join(ROOT, 'character-image-manifest.json');
const REPORT = path.join(ROOT, 'CHARACTER_IMAGE_STABLE_REPORT.md');
const UA = 'ANIME-GAME-stable-character-images/5.0';

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slug = s => norm(s).replace(/\s+/g,'-').replace(/^-|-$/g,'') || 'unknown';
const imgKey = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const localFs = u => path.join(ROOT, String(u||'').replace(/^\//,''));
const isLocal = u => /^\/assets\/images\/chars\//i.test(String(u||''));
const headers = { 'user-agent': UA, 'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' };

async function fetchWithTimeout(url, opts={}, ms=12000){
  const ac = new AbortController(); const t=setTimeout(()=>ac.abort(),ms);
  try{return await fetch(url,{...opts,headers:{...headers,...(opts.headers||{})},signal:ac.signal,redirect:'follow'})}finally{clearTimeout(t)}
}

async function loadJson(file, fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}

function parseFandomMap(server){
  try{
    const m = server.match(/(?:const|let|var)\s+FANDOM_WIKIS\s*=\s*({[\s\S]*?})\s*;/);
    if(!m) return {};
    const sandbox={result:null}; vm.createContext(sandbox); vm.runInContext('result='+m[1],sandbox,{timeout:1000}); return sandbox.result||{};
  }catch{return {}}
}

function sourcesOf(x){
  let a=[]; if(Array.isArray(x?.sources))a=x.sources; else if(Array.isArray(x?.modes))a=x.modes; else if(x?.mode)a=[x.mode];
  return [...new Set(a.map(v=>String(v||'').trim()).filter(Boolean))];
}

function mergeCatalogue(items){
  const map=new Map();
  for(const raw of Array.isArray(items)?items:[]){
    const name=String(raw?.name||'').trim(); const u=String(raw?.u||raw?.universe||'').trim(); const anime=String(raw?.anime||u||'').trim();
    if(!name||!u)continue; const k=norm(u)+'|'+norm(name); const src=sourcesOf(raw); const img=String(raw?.img||raw?.imageUrl||raw?.originalImg||'').trim();
    if(!map.has(k)){map.set(k,{u,anime,name,sources:src,img});continue}
    const old=map.get(k); old.sources=[...new Set([...old.sources,...src])]; if(!old.img&&img)old.img=img;
  }
  return [...map.values()].sort((a,b)=>a.anime.localeCompare(b.anime)||a.name.localeCompare(b.name));
}

function findMapped(charMap,u,name){
  const bucket=charMap?.[u]; if(!bucket||typeof bucket!=='object')return '';
  const wanted=norm(name);
  for(const [k,v] of Object.entries(bucket)) if(norm(k)===wanted && typeof v==='string') return v;
  return '';
}

function setMapped(charMap,u,name,value){
  if(!charMap[u]||typeof charMap[u]!=='object') charMap[u]={};
  const wanted=norm(name); let hit=null;
  for(const k of Object.keys(charMap[u])) if(norm(k)===wanted){hit=k;break}
  charMap[u][hit||imgKey(name)] = value;
}

async function downloadToWebp(url,out){
  if(!url||!/^https?:\/\//i.test(url))return false;
  try{
    const r=await fetchWithTimeout(url,{},15000); if(!r.ok)return false;
    const ct=String(r.headers.get('content-type')||'').toLowerCase(); if(!ct.startsWith('image/'))return false;
    const ab=await r.arrayBuffer(); if(ab.byteLength<800||ab.byteLength>15_000_000)return false;
    await fs.mkdir(path.dirname(out),{recursive:true});
    await sharp(Buffer.from(ab),{failOn:'none'}).rotate().resize({width:480,height:480,fit:'inside',withoutEnlargement:true}).webp({quality:76,effort:4}).toFile(out);
    return true;
  }catch{return false}
}

function candidateScore(c,name,anime){
  const n=norm(name), a=norm(anime); let score=0;
  const names=[c?.name?.full,c?.name?.native,...(c?.name?.alternative||[])].map(norm).filter(Boolean);
  if(names.includes(n))score+=20; else if(names.some(x=>x.includes(n)||n.includes(x)))score+=8;
  const media=(c?.media?.nodes||[]).flatMap(m=>[m?.title?.romaji,m?.title?.english,m?.title?.native,...(m?.synonyms||[])]).map(norm).filter(Boolean);
  const at=a.split(' ').filter(x=>x.length>2);
  if(a&&media.some(t=>t.includes(a)||a.includes(t)))score+=14;
  else if(at.length&&media.some(t=>at.filter(w=>t.includes(w)).length>=Math.min(2,at.length)))score+=6;
  return score;
}

let aniNext=0;
async function anilistImage(name,anime){
  const now=Date.now(); if(now<aniNext)await sleep(aniNext-now); aniNext=Date.now()+900;
  const query=`query($s:String){Page(page:1,perPage:10){characters(search:$s){name{full native alternative} image{large medium} media(perPage:15){nodes{title{romaji english native} synonyms}}}}}`;
  try{
    const r=await fetchWithTimeout('https://graphql.anilist.co',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables:{s:name}})},15000);
    if(r.status===429){await sleep(5000);return anilistImage(name,anime)}
    if(!r.ok)return '';
    const cs=(await r.json())?.data?.Page?.characters||[]; cs.sort((a,b)=>candidateScore(b,name,anime)-candidateScore(a,name,anime));
    const c=cs[0]; return c?.image?.large||c?.image?.medium||'';
  }catch{return ''}
}

async function fandomImage(host,name){
  if(!host)return '';
  host=String(host).replace(/^https?:\/\//,'').replace(/\/$/,'');
  const q=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:name,gsrnamespace:'0',gsrlimit:'6',prop:'pageimages',piprop:'original|thumbnail',pithumbsize:'700'});
  try{
    const r=await fetchWithTimeout(`https://${host}/api.php?${q}`,{},15000); if(!r.ok)return '';
    const pages=Object.values((await r.json())?.query?.pages||{}).sort((a,b)=>(a.index||99)-(b.index||99));
    const p=pages.find(x=>x?.original?.source||x?.thumbnail?.source); return p?.original?.source||p?.thumbnail?.source||'';
  }catch{return ''}
}

let jikanNext=0;
async function jikanImage(name){
  const now=Date.now();if(now<jikanNext)await sleep(jikanNext-now);jikanNext=Date.now()+400;
  try{
    const u='https://api.jikan.moe/v4/characters?limit=10&q='+encodeURIComponent(name); const r=await fetchWithTimeout(u,{},15000); if(r.status===429){await sleep(2500);return jikanImage(name)} if(!r.ok)return '';
    const arr=(await r.json())?.data||[]; const n=norm(name); arr.sort((a,b)=>Number(norm(b.name)===n)-Number(norm(a.name)===n)); const c=arr[0]; return c?.images?.webp?.image_url||c?.images?.jpg?.image_url||'';
  }catch{return ''}
}

async function wikiImage(name,anime){
  try{
    const search=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:`${name} ${anime}`,gsrnamespace:'0',gsrlimit:'5',prop:'pageimages',piprop:'original|thumbnail',pithumbsize:'700'});
    const r=await fetchWithTimeout(`https://en.wikipedia.org/w/api.php?${search}`,{},15000); if(!r.ok)return '';
    const pages=Object.values((await r.json())?.query?.pages||{}).sort((a,b)=>(a.index||99)-(b.index||99));
    const n=norm(name); const p=pages.find(x=>norm(x.title).includes(n)||n.includes(norm(x.title)))||pages[0]; return p?.original?.source||p?.thumbnail?.source||'';
  }catch{return ''}
}

async function makeFallback(out,name,anime){
  const safe=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const initials=String(name).split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#261238"/></linearGradient></defs><rect width="480" height="480" fill="url(#g)"/><circle cx="240" cy="190" r="110" fill="#202b42"/><text x="240" y="220" text-anchor="middle" font-family="Arial,sans-serif" font-size="92" font-weight="700" fill="#f4f7ff">${safe(initials)}</text><text x="240" y="350" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#fff">${safe(String(name).slice(0,28))}</text><text x="240" y="390" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#aab4c7">${safe(String(anime).slice(0,34))}</text></svg>`;
  await fs.mkdir(path.dirname(out),{recursive:true}); await sharp(Buffer.from(svg)).webp({quality:80}).toFile(out);
}

async function main(){
  const charMap=await loadJson(CHAR_FILE,{}); const server=await fs.readFile(SERVER_FILE,'utf8'); const fandom=parseFandomMap(server);
  const rr=await fetchWithTimeout(`${SITE}/api/character-catalog`,{headers:{accept:'application/json'}},30000); if(!rr.ok)throw new Error(`catalog HTTP ${rr.status}`); const data=await rr.json(); const chars=mergeCatalogue(data.characters);
  console.log(`Catalogue: ${data.characters?.length||0} rows -> ${chars.length} unique characters`);
  let stable=0, downloaded=0, foundAni=0, foundFandom=0, foundJikan=0, foundWiki=0, fallback=0; const manifest=[];

  for(let i=0;i<chars.length;i++){
    const x=chars[i]; const dir=path.join(IMG_ROOT,slug(x.u)); const out=path.join(dir,slug(x.name)+'.webp'); const publicUrl='/'+path.relative(ROOT,out).split(path.sep).join('/');
    if(fssync.existsSync(out)){setMapped(charMap,x.u,x.name,publicUrl);stable++;manifest.push({...x,image:publicUrl,source:'local-existing'});continue}

    const mapped=findMapped(charMap,x.u,x.name); const candidates=[];
    if(/^https?:\/\//i.test(mapped))candidates.push(['existing-map',mapped]);
    if(/^https?:\/\//i.test(x.img)&&x.img!==mapped)candidates.push(['catalog',x.img]);
    let source=''; let ok=false;
    for(const [label,url] of candidates){if(await downloadToWebp(url,out)){source=label;ok=true;break}}
    if(!ok){const u=await anilistImage(x.name,x.anime); if(u&&await downloadToWebp(u,out)){source='anilist';foundAni++;ok=true}}
    if(!ok){const u=await fandomImage(fandom[x.u],x.name); if(u&&await downloadToWebp(u,out)){source='fandom';foundFandom++;ok=true}}
    if(!ok){const u=await jikanImage(x.name); if(u&&await downloadToWebp(u,out)){source='jikan';foundJikan++;ok=true}}
    if(!ok){const u=await wikiImage(x.name,x.anime); if(u&&await downloadToWebp(u,out)){source='wikipedia';foundWiki++;ok=true}}
    if(!ok){await makeFallback(out,x.name,x.anime);source='generated-fallback';fallback++}
    else downloaded++;
    setMapped(charMap,x.u,x.name,publicUrl); manifest.push({...x,image:publicUrl,source});
    if((i+1)%25===0||i===chars.length-1)console.log(`${i+1}/${chars.length} • stable ${stable} • downloaded ${downloaded} • fallback ${fallback}`);
  }

  await fs.writeFile(CHAR_FILE,JSON.stringify(charMap,null,2)+'\n'); await fs.writeFile(MANIFEST,JSON.stringify({generatedAt:new Date().toISOString(),site:SITE,total:chars.length,stable,downloaded,anilist:foundAni,fandom:foundFandom,jikan:foundJikan,wikipedia:foundWiki,fallback,characters:manifest},null,2)+'\n');
  await fs.writeFile(REPORT,`# Stable character image report\n\n- Characters unique: **${chars.length}**\n- Already local: **${stable}**\n- Newly downloaded actual images: **${downloaded}**\n- AniList: **${foundAni}**\n- Fandom/Wiki: **${foundFandom}**\n- Jikan: **${foundJikan}**\n- Wikipedia: **${foundWiki}**\n- Generated local fallbacks: **${fallback}**\n\nEvery catalogue character now points to a local file under \`/assets/images/chars/\`. Manual admin URL overrides remain stored in PostgreSQL and still take priority.\n`);
  console.log(`DONE total=${chars.length} stable=${stable} downloaded=${downloaded} fallback=${fallback}`);
}

main().catch(e=>{console.error(e);process.exit(1)});
