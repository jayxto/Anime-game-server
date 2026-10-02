import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const catalog = JSON.parse(fs.readFileSync('/tmp/catalog.json','utf8'));
const rawDb = JSON.parse(fs.readFileSync('/tmp/characters.json','utf8'));
const db = Array.isArray(rawDb) ? rawDb : (rawDb.data || []);
const rows = catalog.characters || catalog.items || catalog.catalog || [];

const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’'`]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const slug = s => norm(s).replace(/ /g,'-') || '_global';
const compact = s => norm(s).replace(/ /g,'');
const words = s => norm(s).split(' ').filter(Boolean);
const uniq = a => [...new Set(a.filter(Boolean))];
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function lev(a,b){a=compact(a);b=compact(b);if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;let p=Array.from({length:b.length+1},(_,i)=>i),c=new Array(b.length+1);for(let i=1;i<=a.length;i++){c[0]=i;for(let j=1;j<=b.length;j++)c[j]=Math.min(c[j-1]+1,p[j]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));[p,c]=[c,p];}return p[b.length];}
function sim(a,b){const A=norm(a),B=norm(b);if(!A||!B)return 0;if(A===B)return 1;if(compact(A)===compact(B))return .99;const mx=Math.max(compact(A).length,compact(B).length);let s=1-lev(A,B)/Math.max(1,mx);const aa=new Set(words(A)),bb=new Set(words(B));let k=0;for(const w of aa)if(bb.has(w))k++;const tok=k/Math.max(1,Math.max(aa.size,bb.size));if(A.includes(B)||B.includes(A))s=Math.max(s,.82*Math.min(A.length,B.length)/Math.max(A.length,B.length)+.12);return Math.max(s,tok*.92);}

const charNames = c => uniq([c?.name,c?.name_kanji,...(c?.nicknames||[]),...(c?.aliases||[])]);
const animeObjs = c => (c?.animeAppearances||c?.anime||[]).map(x=>x?.anime||x).filter(Boolean);
const animeTitles = a => uniq([a?.title,a?.title_english,a?.title_japanese,...(a?.title_synonyms||[])]);
const charImg = c => c?.images?.webp?.large_image_url||c?.images?.webp?.image_url||c?.images?.jpg?.large_image_url||c?.images?.jpg?.image_url||c?.image_url||c?.image||'';
const animeImg = a => a?.images?.webp?.large_image_url||a?.images?.webp?.image_url||a?.images?.jpg?.large_image_url||a?.images?.jpg?.image_url||a?.image_url||a?.image||'';

const exactName=new Map(), compactName=new Map(), tokenIndex=new Map(), animeExact=new Map(), animeToken=new Map();
function add(m,k,v){if(!k)return;if(!m.has(k))m.set(k,[]);m.get(k).push(v);}
for(const c of db){
  for(const n of charNames(c)){add(exactName,norm(n),c);add(compactName,compact(n),c);for(const w of words(n))if(w.length>=3)add(tokenIndex,w,c);}
  for(const a of animeObjs(c))for(const t of animeTitles(a)){add(animeExact,norm(t),a);for(const w of words(t))if(w.length>=4)add(animeToken,w,a);}
}

const entries=new Map(), universeSeries=new Map();
for(const x of rows){const u=x.universeKey||x.universe||x.u||x.key||x.animeKey||'';const n=x.name||x.character||x.displayName||x.label||'';if(!n)continue;const anime=x.anime||x.animeTitle||x.series||x.universeName||'';const k=slug(u)+'|'+slug(n);if(!entries.has(k))entries.set(k,{...x,u,n,anime});if(u&&anime&&!universeSeries.has(slug(u)))universeSeries.set(slug(u),anime);}

const exts=['.webp','.png','.jpg','.jpeg'];
const outFile=x=>path.join('music','char-images',slug(x.u),slug(x.n)+'.webp');
function existing(x){const d=path.join('music','char-images',slug(x.u)),b=slug(x.n);return exts.map(e=>path.join(d,b+e)).find(f=>fs.existsSync(f)&&fs.statSync(f).size>700)||'';}
const universeFallback=new Map();
for(const x of entries.values()){const f=existing(x);if(f&&x.u&&!universeFallback.has(slug(x.u)))universeFallback.set(slug(x.u),f);}

const formWords=new Set(['mode','forme','form','gear','sage','ermite','baryon','susanoo','bankai','resurreccion','awakened','awakening','eveille','eveillee','ultimate','final','perfect','warrior','level','zero','six','paths','rikudo','demon','fiend','titan','armored','colossal','super','ultra','mega','gigamax','gmax','ssj','ssj2','ssj3','ssj4','blue','god','beast','orange','snakeman','boundman','nika','kurama','chakra']);
function nameHints(x){const a=[x.n];const an=String(x.anime||'');if(an.includes('•')){const p=an.split('•').map(s=>s.trim()).filter(Boolean);if(p[0]&&!['anime','shonen','seinen','isekai'].includes(norm(p[0])))a.push(p[0]);}const cleaned=words(x.n).filter(w=>!formWords.has(w)&&!/^\d+$/.test(w)).join(' ');if(cleaned&&cleaned!==norm(x.n))a.push(cleaned);const noParen=String(x.n).replace(/[\(\[].*?[\)\]]/g,' ').replace(/\s+/g,' ').trim();if(noParen)a.push(noParen);return uniq(a);}
function seriesHints(x){const a=[];const an=String(x.anime||'').trim();if(an){a.push(an);if(an.includes('•'))a.push(...an.split('•').map(s=>s.trim()).slice(1));}if(x.u&&universeSeries.has(slug(x.u)))a.push(universeSeries.get(slug(x.u)));a.push(x.u);return uniq(a).filter(z=>!['anime','shonen','seinen','isekai','shojo','sport','sports','movie','film'].includes(norm(z)));}
function animeScore(c,ss){let b=0;for(const a of animeObjs(c))for(const t of animeTitles(a))for(const s of ss)b=Math.max(b,sim(t,s));return b;}
function candidates(x){const s=new Set();for(const h of nameHints(x)){for(const c of exactName.get(norm(h))||[])s.add(c);for(const c of compactName.get(compact(h))||[])s.add(c);for(const w of words(h))if(w.length>=3)for(const c of tokenIndex.get(w)||[])s.add(c);}return [...s];}
function pickChar(x){const hs=nameHints(x),ss=seriesHints(x);let best=null;for(const c of candidates(x)){const url=charImg(c);if(!url)continue;let ns=0;for(const cn of charNames(c))for(const h of hs)ns=Math.max(ns,sim(cn,h));const as=animeScore(c,ss);const exact=hs.some(h=>charNames(c).some(cn=>norm(cn)===norm(h)||compact(cn)===compact(h)));const score=(exact?1.2:0)+ns*1.5+as;if(ns<.56)continue;if(ss.length&&as<.18&&!exact)continue;if(!best||score>best.score)best={url,ns,as,score,exact};}if(!best)return null;if(best.exact&&(!ss.length||best.as>=.2))return {...best,kind:'character-exact'};if(best.ns>=.82&&(!ss.length||best.as>=.3))return {...best,kind:'character-fuzzy'};if(best.ns>=.68&&best.as>=.62)return {...best,kind:'character-series'};return null;}
function pickCover(x){let best=null;for(const s of seriesHints(x)){for(const a of animeExact.get(norm(s))||[]){const url=animeImg(a);if(url)return {url,kind:'anime-cover-exact',score:1};}const cand=new Set();for(const w of words(s))if(w.length>=4)for(const a of animeToken.get(w)||[])cand.add(a);for(const a of cand){const url=animeImg(a);if(!url)continue;let sc=0;for(const t of animeTitles(a))sc=Math.max(sc,sim(t,s));if(sc>=.58&&(!best||sc>best.score))best={url,kind:'anime-cover-fuzzy',score:sc};}}return best;}

async function fetchBuf(url){for(let a=1;a<=3;a++){const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),15000);try{const r=await fetch(url,{redirect:'follow',signal:ac.signal,headers:{'user-agent':'Mozilla/5.0 AnimeGameCoverage/4.1','accept':'image/*'}});if(!r.ok)throw new Error('HTTP '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length<700)throw new Error('small');return b;}catch(e){if(a===3)return null;await new Promise(q=>setTimeout(q,350*a));}finally{clearTimeout(tm);}}return null;}
async function write(out,input){fs.mkdirSync(path.dirname(out),{recursive:true});const tmp=out+'.tmp-'+process.pid+'-'+Math.random().toString(36).slice(2);try{await sharp(input,{animated:false}).rotate().resize({width:420,height:588,fit:'inside',withoutEnlargement:true,background:{r:17,g:20,b:29,alpha:1}}).webp({quality:76,effort:4}).toFile(tmp);if(fs.statSync(tmp).size<700)throw new Error('small');fs.renameSync(tmp,out);return true;}catch{try{fs.rmSync(tmp,{force:true});}catch{}return false;}}
function wrap(s,max=25){const a=String(s||'').split(/\s+/),out=[];let cur='';for(const w of a){if((cur+' '+w).trim().length>max&&cur){out.push(cur);cur=w;}else cur=(cur+' '+w).trim();}if(cur)out.push(cur);return out.slice(0,4);}
async function generate(x,out){const t=wrap(x.n),s=wrap(seriesHints(x)[0]||x.anime||x.u||'ANIME GAME',30);const ts=t.map((l,i)=>`<text x="210" y="${245+i*48}" text-anchor="middle" font-size="38" font-weight="700" fill="#fff">${esc(l)}</text>`).join('');const ss=s.map((l,i)=>`<text x="210" y="${452+i*28}" text-anchor="middle" font-size="20" fill="#a3a3a3">${esc(l)}</text>`).join('');const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="588"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#05070d"/></linearGradient></defs><rect width="420" height="588" fill="url(#g)"/><circle cx="210" cy="120" r="64" fill="#1f2937"/><path d="M155 120h110M210 65v110" stroke="#64748b" stroke-width="8" opacity=".25"/>${ts}${ss}<text x="210" y="548" text-anchor="middle" font-size="17" fill="#6b7280">ANIME GAME</text></svg>`;return write(out,Buffer.from(svg));}

const targets=[...entries.values()].filter(x=>!existing(x));
const decisions=targets.map(x=>{const c=pickChar(x);if(c)return {x,...c};const a=pickCover(x);if(a)return {x,...a};const local=x.u?universeFallback.get(slug(x.u)):'';if(local)return {x,kind:'universe-local-fallback',local};const g=path.join('music','char-images','_global',slug(seriesHints(x)[0]||x.anime)+'.webp');if(fs.existsSync(g)&&fs.statSync(g).size>700)return {x,kind:'global-cover-fallback',local:g};return {x,kind:'generated-fallback'};});

const quality={};let cursor=0,created=0,failedPrimary=0;const recovered=[];
async function one(d){const out=outFile(d.x);let ok=false,kind=d.kind;if(d.url){const b=await fetchBuf(d.url);if(b)ok=await write(out,b);if(!ok){failedPrimary++;const local=d.x.u?universeFallback.get(slug(d.x.u)):'';if(local){ok=await write(out,local);kind='source-failed-universe-fallback';}if(!ok){ok=await generate(d.x,out);kind='source-failed-generated-fallback';}recovered.push({u:d.x.u,n:d.x.n,from:d.kind,to:kind});}}else if(d.local){ok=await write(out,d.local);if(!ok){ok=await generate(d.x,out);kind='local-failed-generated-fallback';}}else ok=await generate(d.x,out);if(!ok){ok=await generate(d.x,out);kind='generated-retry';}if(ok){created++;quality[kind]=(quality[kind]||0)+1;}}
async function worker(){while(true){const i=cursor++;if(i>=decisions.length)return;await one(decisions[i]);if(i%100===0)console.log('PROGRESS',i,'/',decisions.length,'CREATED',created);}}

await Promise.all(Array.from({length:14},worker));
let have=0;const missing=[];for(const x of entries.values()){if(existing(x))have++;else missing.push({u:x.u,n:x.n,anime:x.anime||'',sources:x.sources||[]});}
const report={total:entries.size,startMissing:targets.length,created,canonical:have,missing:missing.length,coverage:+(have*100/entries.size).toFixed(2),failedPrimaryRecovered:failedPrimary,quality,recovered,missingEntries:missing};
fs.writeFileSync('PHASE4_IMAGE_REPORT.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(missing.length)process.exit(2);
