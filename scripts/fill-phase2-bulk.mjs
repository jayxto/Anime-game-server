import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import sharp from 'sharp';
import { spawn } from 'child_process';

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const slug=s=>norm(s).replace(/ /g,'-');
const sig=s=>norm(s).split(' ').filter(Boolean).sort().join(' ');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const exts=['.webp','.png','.jpg','.jpeg'];
function outPath(x){return path.join('music','char-images',slug(x.u)||'_global',slug(x.n)+'.webp');}
function has(x){const d=path.dirname(outPath(x)),b=slug(x.n);return exts.some(e=>{const f=path.join(d,b+e);return fs.existsSync(f)&&fs.statSync(f).size>700;});}
async function fetchBuf(url,timeout=18000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{redirect:'follow',signal:c.signal,headers:{'User-Agent':'AnimeGameImageFill/2.1','Accept':'image/*,*/*;q=0.8'}});if(!r.ok)throw new Error(`${r.status} ${url}`);return Buffer.from(await r.arrayBuffer());}finally{clearTimeout(t);}}
async function boot(){const log=fs.openSync('/tmp/phase2-fill-server.log','a');const p=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3099'},stdio:['ignore',log,log]});for(let i=0;i<90;i++){try{const r=await fetch('http://127.0.0.1:3099/api/character-catalog');if(r.ok)return {p,data:await r.json()};}catch{}await sleep(1000);}p.kill();throw new Error('catalog unavailable');}
function unique(data){const m=new Map();for(const x of (data.characters||[])){const u=x.universeKey||x.universe||x.u||x.key||x.animeKey||'';const n=x.name||x.character||x.displayName||x.label||'';if(n)m.set(slug(u)+'|'+slug(n),{...x,u,n});}return [...m.values()];}
function imageUrl(c){return c?.images?.webp?.image_url||c?.images?.jpg?.image_url||c?.images?.image_url||c?.image_url||null;}
function animeTitles(c){return (c?.animeAppearances||[]).map(a=>a?.anime?.title||a?.anime?.title_english||'').filter(Boolean);}
function tokens(s){return new Set(norm(s).split(' ').filter(x=>x.length>1));}
function animeScore(c,wanted){const raw=String(wanted||'').split('•').pop();const ws=tokens(raw);if(!ws.size)return 0;let best=0;for(const t of animeTitles(c)){const ts=tokens(t);if(!ts.size)continue;let inter=0;for(const w of ws)if(ts.has(w))inter++;const union=new Set([...ws,...ts]).size||1;let score=inter/union;const nw=norm(raw),nt=norm(t);if(nw&&nt&&(nw.includes(nt)||nt.includes(nw)))score+=0.6;best=Math.max(best,score);}return best;}
function parseCsvLine(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===','&&!q){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;}
async function save(x,url){const out=outPath(x);fs.mkdirSync(path.dirname(out),{recursive:true});const tmp=out+'.tmp-'+process.pid+'-'+Math.random().toString(36).slice(2);try{const b=await fetchBuf(url);if(b.length<700)throw new Error('small');await sharp(b,{animated:false}).rotate().resize({width:480,height:672,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toFile(tmp);if(fs.statSync(tmp).size<700)throw new Error('small-out');fs.renameSync(tmp,out);return {ok:true,size:fs.statSync(out).size};}catch(e){try{fs.rmSync(tmp,{force:true});}catch{}return {ok:false,error:String(e?.message||e)};}}

const {p:server,data}=await boot();
try{
  const all=unique(data), missing=all.filter(x=>!has(x));
  const gz=await fetchBuf('https://raw.githubusercontent.com/arda-/anime-character-offline-database/prod/latest/characters.min.json.gz',30000);
  const db=JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  const byName=new Map(),bySig=new Map();
  const add=(m,k,c)=>{if(!k)return;const a=m.get(k)||[];a.push(c);m.set(k,a);};
  for(const c of (db.data||[])){for(const n of [c.name,...(c.nicknames||[])].filter(Boolean)){add(byName,norm(n),c);add(bySig,sig(n),c);}}
  const queue=[];let ambiguous=0;
  for(const x of missing.filter(x=>slug(x.u)!=='pokemon')){
    let cand=byName.get(norm(x.n))||[],mode='exact';
    if(!cand.length){cand=bySig.get(sig(x.n))||[];mode='reordered';}
    cand=[...new Set(cand)];if(!cand.length)continue;
    const ranked=cand.map(c=>({c,score:animeScore(c,x.anime||x.u)})).sort((a,b)=>b.score-a.score);
    const pick=ranked[0];if(!pick)continue;
    if(cand.length>1&&pick.score<0.12){ambiguous++;continue;}
    if(norm(x.n).length<=4&&pick.score<0.12){ambiguous++;continue;}
    const url=imageUrl(pick.c);if(url)queue.push({x,url,source:'mal-offline',dbName:pick.c.name,mode,score:pick.score});
  }
  const csv=(await fetchBuf('https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv',30000)).toString('utf8');
  const poke=new Map();for(const line of csv.split(/\r?\n/).slice(1)){if(!line)continue;const r=parseCsvLine(line);if(['5','9'].includes(String(r[1])))poke.set(norm(r[2]),Number(r[0]));}
  for(const x of missing.filter(x=>slug(x.u)==='pokemon')){const id=poke.get(norm(x.n));if(id)queue.push({x,url:`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,source:'pokeapi',id});}
  const dedup=new Map();for(const q of queue)dedup.set(slug(q.x.u)+'|'+slug(q.x.n),q);const work=[...dedup.values()].filter(q=>!has(q.x));
  let i=0,ok=0,fail=0;const failures=[],saved=[];
  async function worker(){while(true){const k=i++;if(k>=work.length)return;const q=work[k];const r=await save(q.x,q.url);if(r.ok){ok++;saved.push({u:q.x.u,n:q.x.n,source:q.source,url:q.url,size:r.size});}else{fail++;failures.push({u:q.x.u,n:q.x.n,source:q.source,url:q.url,error:r.error});}if((ok+fail)%100===0)console.log('PROGRESS',ok+fail,'/',work.length,'OK',ok,'FAIL',fail);}}
  await Promise.all(Array.from({length:10},worker));
  let canonical=0;const remaining=[];for(const x of all){if(has(x))canonical++;else remaining.push({u:x.u,n:x.n,anime:x.anime||'',sources:x.sources||[]});}
  const report={total:all.length,missingStart:missing.length,candidates:work.length,saved:ok,failed:fail,ambiguousSkipped:ambiguous,canonical,missing:remaining.length,coverage:Number((canonical*100/all.length).toFixed(2)),failures:failures.slice(0,300),savedSamples:saved.slice(0,100),remainingFirst500:remaining.slice(0,500)};
  fs.writeFileSync('PHASE2_FILL_REPORT.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,failures:undefined,savedSamples:undefined,remainingFirst500:undefined},null,2));
} finally {server.kill();}
