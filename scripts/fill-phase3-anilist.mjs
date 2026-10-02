import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { spawn } from 'child_process';

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const slug=s=>norm(s).replace(/ /g,'-');
const sig=s=>norm(s).split(' ').filter(Boolean).sort().join(' ');
const toks=s=>new Set(norm(s).split(' ').filter(Boolean));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const exts=['.webp','.png','.jpg','.jpeg'];
const GENERIC=new Set(['anime','shonen','isekai','transformation','ost','combat','arc','protagoniste','antagoniste','rival','design']);
const FORM_RE=/\b(bankai|shikai|gear\s*[2-9]|sage|sennin|susanoo|perfect warrior|level zero|fiend|titan|super saiyan|ssj|ultra instinct|god mode|demon form|devil form|awakened|awakening|transformation|mode|forme|form|armored|baryon|six paths|chakra mode|dragon force|overdrive|resurreccion|vollstandig|segunda etapa|hollow|vastolorde|vasto lorde)\b/i;

function outPath(x){return path.join('music','char-images',slug(x.u)||'_global',slug(x.n)+'.webp');}
function has(x){const d=path.dirname(outPath(x)),b=slug(x.n);return exts.some(e=>{const f=path.join(d,b+e);return fs.existsSync(f)&&fs.statSync(f).size>700;});}
function uniq(data){const m=new Map();for(const x of (data.characters||[])){const u=x.universeKey||x.universe||x.u||x.key||x.animeKey||'';const n=x.name||x.character||x.displayName||x.label||'';if(n)m.set(slug(u)+'|'+slug(n),{...x,u,n});}return [...m.values()];}
async function boot(){const log=fs.openSync('/tmp/phase3-server.log','a');const p=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3099'},stdio:['ignore',log,log]});for(let i=0;i<90;i++){try{const r=await fetch('http://127.0.0.1:3099/api/character-catalog');if(r.ok)return {p,data:await r.json()};}catch{}await sleep(1000);}p.kill();throw new Error('catalog unavailable');}
function seriesOf(x){let a=String(x.anime||'').trim();if(a.includes('•'))a=a.split('•').pop().trim();if(a&&!GENERIC.has(norm(a)))return a;return ''}
function isMediaVisual(x){return !String(x.u||'').trim() && GENERIC.has(norm(x.anime||'')) && !FORM_RE.test(x.n);}
function isSpecialVisual(x){return FORM_RE.test(`${x.n} ${x.anime||''}`)||String(x.anime||'').includes('•');}
function titleValues(m){return [m?.title?.romaji,m?.title?.english,m?.title?.native].filter(Boolean)}
function nameValues(c){return [c?.name?.full,c?.name?.native,...(c?.name?.alternative||[])].filter(Boolean)}
function overlap(a,b){const A=toks(a),B=toks(b);if(!A.size||!B.size)return 0;let i=0;for(const x of A)if(B.has(x))i++;return (2*i)/(A.size+B.size)}
function textScore(a,b){const A=norm(a),B=norm(b);if(!A||!B)return 0;if(A===B)return 1;if(sig(A)===sig(B))return .98;if(A.includes(B)||B.includes(A)){const r=Math.min(A.length,B.length)/Math.max(A.length,B.length);return .78+.18*r;}return overlap(A,B)*.86;}
function bestNameScore(c,w){return Math.max(0,...nameValues(c).map(n=>textScore(n,w)));}
function bestTitleScore(m,w){return Math.max(0,...titleValues(m).map(n=>textScore(n,w)));}

let gqlGate=Promise.resolve();
async function gql(query,variables){
  let release;const prev=gqlGate;gqlGate=new Promise(r=>release=r);await prev;
  try{await sleep(780);let tries=0;while(true){tries++;const r=await fetch('https://graphql.anilist.co',{method:'POST',headers:{'content-type':'application/json','accept':'application/json','user-agent':'AnimeGameCoverage/3.0'},body:JSON.stringify({query,variables})});if(r.status===429&&tries<6){const wait=Number(r.headers.get('retry-after')||3)*1000;await sleep(wait);continue;}if(!r.ok)throw new Error(`AniList ${r.status}`);return await r.json();}}finally{release();}
}
async function findMedia(title){
 const q=`query($s:String){Page(page:1,perPage:8){media(search:$s,type:ANIME,sort:[SEARCH_MATCH,POPULARITY_DESC]){id title{romaji english native}coverImage{extraLarge large}bannerImage}}}`;
 try{const d=await gql(q,{s:title});const arr=d?.data?.Page?.media||[];const ranked=arr.map(m=>({m,s:bestTitleScore(m,title)})).sort((a,b)=>b.s-a.s);return ranked[0]&&ranked[0].s>=.58?ranked[0].m:null;}catch{return null;}
}
const mediaCache=new Map();
async function mediaFor(title){const k=norm(title);if(mediaCache.has(k))return mediaCache.get(k);const p=findMedia(title);mediaCache.set(k,p);return p;}
const charsCache=new Map();
async function charactersFor(media){if(!media)return[];if(charsCache.has(media.id))return charsCache.get(media.id);const out=[];const q=`query($id:Int,$p:Int){Media(id:$id,type:ANIME){characters(page:$p,perPage:50,sort:[ROLE,RELEVANCE]){pageInfo{hasNextPage}nodes{name{full native alternative}image{large medium}}}}}`;for(let p=1;p<=8;p++){try{const d=await gql(q,{id:media.id,p});const c=d?.data?.Media?.characters;if(!c)break;out.push(...(c.nodes||[]));if(!c.pageInfo?.hasNextPage)break;}catch{break;}}charsCache.set(media.id,out);return out;}
async function fetchBuf(url,timeout=18000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{redirect:'follow',signal:c.signal,headers:{'User-Agent':'AnimeGameCoverage/3.0','Accept':'image/*,*/*;q=0.8'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return Buffer.from(await r.arrayBuffer());}finally{clearTimeout(t);}}
async function save(x,url){const out=outPath(x);fs.mkdirSync(path.dirname(out),{recursive:true});const tmp=out+'.tmp-'+process.pid;try{const b=await fetchBuf(url);if(b.length<700)throw new Error('small');await sharp(b,{animated:false}).rotate().resize({width:480,height:672,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toFile(tmp);if(fs.statSync(tmp).size<700)throw new Error('small-out');fs.renameSync(tmp,out);return true;}catch{try{fs.rmSync(tmp,{force:true});}catch{}return false;}}

const {p:server,data}=await boot();
try{
 const all=uniq(data),start=all.filter(x=>!has(x));let savedMedia=0,savedChars=0,failed=0;
 const mediaVisuals=start.filter(isMediaVisual);
 for(const [i,x] of mediaVisuals.entries()){
   const m=await mediaFor(x.n);const url=m?.coverImage?.extraLarge||m?.coverImage?.large||m?.bannerImage;
   if(url&&await save(x,url))savedMedia++;else failed++;
   if((i+1)%25===0)console.log('MEDIA',i+1,'/',mediaVisuals.length,'saved',savedMedia);
 }
 const targets=start.filter(x=>!has(x)&&!isMediaVisual(x)&&!isSpecialVisual(x)&&seriesOf(x));
 const groups=new Map();for(const x of targets){const s=seriesOf(x);const a=groups.get(s)||[];a.push(x);groups.set(s,a);}
 let gi=0;
 for(const [series,list] of groups){gi++;const m=await mediaFor(series);if(!m){failed+=list.length;continue;}const chars=await charactersFor(m);if(!chars.length){failed+=list.length;continue;}
   for(const x of list){
     const ranked=chars.map(c=>({c,s:bestNameScore(c,x.n)})).sort((a,b)=>b.s-a.s);const a=ranked[0],b=ranked[1];
     if(!a||a.s<.72||(a.s<.91&&b&&a.s-b.s<.08))continue;
     const url=a.c?.image?.large||a.c?.image?.medium;if(url&&await save(x,url))savedChars++;
   }
   console.log('SERIES',gi,'/',groups.size,series,'targets',list.length,'chars',chars.length,'totalSaved',savedChars);
 }
 const finalMissing=all.filter(x=>!has(x));const report={total:all.length,missingStart:start.length,mediaVisuals:mediaVisuals.length,savedMedia,savedCharacters:savedChars,failedDownloads:failed,canonical:all.length-finalMissing.length,missing:finalMissing.length,coverage:Number(((all.length-finalMissing.length)*100/all.length).toFixed(2)),specialVisualsRemaining:finalMissing.filter(isSpecialVisual).length,mediaVisualsRemaining:finalMissing.filter(isMediaVisual).length,remainingBySource:{}};
 for(const x of finalMissing)for(const s of (x.sources||[]))report.remainingBySource[s]=(report.remainingBySource[s]||0)+1;
 report.remaining=finalMissing;
 fs.writeFileSync('PHASE3_ANILIST_REPORT.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,remaining:undefined},null,2));
}finally{server.kill();}
