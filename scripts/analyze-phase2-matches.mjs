import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawn } from 'child_process';

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const slug=s=>norm(s).replace(/ /g,'-');
const sig=s=>norm(s).split(' ').filter(Boolean).sort().join(' ');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function outPath(x){return path.join('music','char-images',slug(x.u)||'_global',slug(x.n)+'.webp');}
function has(x){const f=outPath(x);return fs.existsSync(f)&&fs.statSync(f).size>700;}
async function fetchBuf(url){const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':'AnimeGameImageAudit/2.0'}});if(!r.ok)throw new Error(`${r.status} ${url}`);return Buffer.from(await r.arrayBuffer());}
async function boot(){const log=fs.openSync('/tmp/phase2-server.log','a');const p=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3099'},stdio:['ignore',log,log]});for(let i=0;i<90;i++){try{const r=await fetch('http://127.0.0.1:3099/api/character-catalog');if(r.ok)return {p,data:await r.json()};}catch{}await sleep(1000);}p.kill();throw new Error('catalog unavailable');}
function unique(data){const m=new Map();for(const x of (data.characters||[])){const u=x.universeKey||x.universe||x.u||x.key||x.animeKey||'';const n=x.name||x.character||x.displayName||x.label||'';if(n)m.set(slug(u)+'|'+slug(n),{...x,u,n});}return [...m.values()];}
function imageUrl(c){return c?.images?.webp?.image_url||c?.images?.jpg?.image_url||c?.images?.image_url||c?.image_url||null;}
function animeTitles(c){return (c?.animeAppearances||[]).map(a=>a?.anime?.title||a?.anime?.title_english||'').filter(Boolean);}
function tokens(s){return new Set(norm(s).split(' ').filter(x=>x.length>1));}
function animeScore(c, wanted){const ws=tokens(String(wanted||'').split('•').pop());if(!ws.size)return 0;let best=0;for(const t of animeTitles(c)){const ts=tokens(t);if(!ts.size)continue;let inter=0;for(const w of ws)if(ts.has(w))inter++;const j=inter/Math.max(1,new Set([...ws,...ts]).size);const nw=norm(String(wanted||'').split('•').pop()),nt=norm(t);const bonus=(nw&&nt&&(nw.includes(nt)||nt.includes(nw)))?0.6:0;best=Math.max(best,j+bonus);}return best;}
function parseCsvLine(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===','&&!q){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;}

const {p:server,data}=await boot();
try{
  const all=unique(data), missing=all.filter(x=>!has(x));
  console.log('MISSING_START',missing.length);
  const gz=await fetchBuf('https://raw.githubusercontent.com/arda-/anime-character-offline-database/prod/latest/characters.min.json.gz');
  const db=JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  console.log('CHAR_DB',db?.data?.length||0,'SAMPLE_IMAGES',JSON.stringify(db?.data?.[0]?.images||null));
  const byName=new Map(),bySig=new Map();
  function add(map,k,c){if(!k)return;const a=map.get(k)||[];a.push(c);map.set(k,a);}
  for(const c of (db.data||[])){
    const names=[c.name,...(c.nicknames||[])].filter(Boolean);
    for(const n of names){add(byName,norm(n),c);add(bySig,sig(n),c);}
  }
  let exact=0,reordered=0,withImage=0,ambiguous=0;const matches=[];
  for(const x of missing.filter(x=>slug(x.u)!=='pokemon')){
    let cand=byName.get(norm(x.n))||[];let mode='exact';
    if(!cand.length){cand=bySig.get(sig(x.n))||[];mode='reordered';}
    cand=[...new Set(cand)];
    if(!cand.length)continue;
    const ranked=cand.map(c=>({c,score:animeScore(c,x.anime||x.u)})).sort((a,b)=>b.score-a.score);
    let pick=ranked[0];
    if(cand.length>1 && pick.score<0.12){ambiguous++;continue;}
    if(norm(x.n).length<=4 && pick.score<0.12){ambiguous++;continue;}
    const url=imageUrl(pick.c);if(!url)continue;
    if(mode==='exact')exact++;else reordered++;withImage++;
    matches.push({u:x.u,n:x.n,anime:x.anime||'',url,dbName:pick.c.name,score:+pick.score.toFixed(3),mode});
  }
  const csv=(await fetchBuf('https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv')).toString('utf8');
  const fr=new Map();for(const line of csv.split(/\r?\n/).slice(1)){if(!line)continue;const r=parseCsvLine(line);if(String(r[1])==='5')fr.set(norm(r[2]),Number(r[0]));}
  const pm=[];for(const x of missing.filter(x=>slug(x.u)==='pokemon')){const id=fr.get(norm(x.n));if(id)pm.push({u:x.u,n:x.n,id,url:`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`});}
  const report={total:all.length,missingStart:missing.length,animeDbCharacters:db.data?.length||0,animeMatches:matches.length,animeExact:exact,animeReordered:reordered,animeAmbiguousSkipped:ambiguous,pokemonMissing:missing.filter(x=>slug(x.u)==='pokemon').length,pokemonOfficialMatches:pm.length,potentialAfterBulk:missing.length-matches.length-pm.length,animeMatchSamples:matches.slice(0,100),pokemonUnmatched:missing.filter(x=>slug(x.u)==='pokemon'&&!fr.has(norm(x.n))).map(x=>x.n).slice(0,300)};
  fs.writeFileSync('PHASE2_MATCH_REPORT.json',JSON.stringify(report,null,2));
  fs.writeFileSync('/tmp/phase2-anime-matches.json',JSON.stringify(matches));
  fs.writeFileSync('/tmp/phase2-pokemon-matches.json',JSON.stringify(pm));
  console.log(JSON.stringify(report,null,2));
} finally {server.kill();}
