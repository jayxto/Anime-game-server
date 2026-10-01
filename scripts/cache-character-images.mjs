#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = process.cwd();
const CHAR_FILE = path.join(ROOT, 'char-images.json');
const IMG_ROOT = path.join(ROOT, 'assets', 'images');
const CHAR_ROOT = path.join(IMG_ROOT, 'chars');
const EXTRA_ROOT = path.join(IMG_ROOT, 'external');
const MANIFEST_FILE = path.join(IMG_ROOT, 'image-sources.json');
const REPORT_FILE = path.join(ROOT, 'image-cache-report.json');
const MISSING_FILE = path.join(ROOT, 'images-a-verifier.json');
const REPORT_MD = path.join(ROOT, 'IMAGE_CACHE_REPORT.md');
const DATA_FILES = ['qap-themes.json', 'tierlist-themes.json'];
const CODE_FILES = ['index.html', 'server.js'];
const JS_DIR = path.join(ROOT, 'assets', 'js');

const CONCURRENCY = Math.max(1, Math.min(Number(process.env.IMAGE_CACHE_CONCURRENCY || 8), 12));
const SIZE = Math.max(192, Math.min(Number(process.env.IMAGE_CACHE_SIZE || 384), 640));
const QUALITY = Math.max(60, Math.min(Number(process.env.IMAGE_CACHE_QUALITY || 78), 90));
const REFRESH = process.argv.includes('--refresh') || process.env.IMAGE_CACHE_REFRESH === '1';
const CHECK_ONLY = process.argv.includes('--check-only');
const USER_AGENT = 'ANIME-GAME image-cache/1.0 (jayxto/Anime-game-server)';

const animeAliases = {
  naruto:'Naruto',onepiece:'One Piece',bleach:'Bleach',hxh:'Hunter x Hunter',hunterxhunter:'Hunter x Hunter',
  snk:'Attack on Titan',aot:'Attack on Titan',attackontitan:'Attack on Titan',nanatsu:'The Seven Deadly Sins',
  sevendeadlysins:'The Seven Deadly Sins',deathnote:'Death Note',cote:'Classroom of the Elite',
  classroomoftheelite:'Classroom of the Elite',sololeveling:'Solo Leveling',blackclover:'Black Clover',clover:'Black Clover',
  fireforce:'Fire Force',mushokutensei:'Mushoku Tensei: Jobless Reincarnation',rezero:'Re:ZERO -Starting Life in Another World-',
  fairytail:'Fairy Tail',fairy:'Fairy Tail',bluelock:'Blue Lock',fma:'Fullmetal Alchemist: Brotherhood',
  fullmetalalchemist:'Fullmetal Alchemist: Brotherhood',chainsaw:'Chainsaw Man',chainsawman:'Chainsaw Man',wakfu:'Wakfu',
  demonslayer:'Demon Slayer: Kimetsu no Yaiba',kimetsu:'Demon Slayer: Kimetsu no Yaiba',pokemon:'Pokémon',
  dragonball:'Dragon Ball',hellsparadise:"Hell's Paradise",jigokuraku:"Hell's Paradise",gachakuta:'Gachiakuta',gachiakuta:'Gachiakuta',
  haikyuu:'Haikyu!!',jujika:'Juujika no Rokunin',jojo:"JoJo's Bizarre Adventure",tensura:'That Time I Got Reincarnated as a Slime',
  onepunchman:'One Punch Man',sao:'Sword Art Online',swordartonline:'Sword Art Online',tokyoghoul:'Tokyo Ghoul',
  tokyo_revengers:'Tokyo Revengers',tokyorevengers:'Tokyo Revengers'
};

const fandomWikis = {
  naruto:'naruto.fandom.com',onepiece:'onepiece.fandom.com',bleach:'bleach.fandom.com',hxh:'hunterxhunter.fandom.com',
  hunterxhunter:'hunterxhunter.fandom.com',snk:'attackontitan.fandom.com',aot:'attackontitan.fandom.com',
  attackontitan:'attackontitan.fandom.com',nanatsu:'nanatsu-no-taizai.fandom.com',sevendeadlysins:'nanatsu-no-taizai.fandom.com',
  deathnote:'deathnote.fandom.com',cote:'you-zitsu.fandom.com',classroomoftheelite:'you-zitsu.fandom.com',
  sololeveling:'solo-leveling.fandom.com',blackclover:'blackclover.fandom.com',clover:'blackclover.fandom.com',fireforce:'fire-force.fandom.com',
  mushokutensei:'mushokutensei.fandom.com',rezero:'rezero.fandom.com',fairytail:'fairytail.fandom.com',fairy:'fairytail.fandom.com',
  bluelock:'bluelock.fandom.com',fma:'fma.fandom.com',fullmetalalchemist:'fma.fandom.com',
  chainsaw:'chainsaw-man.fandom.com',chainsawman:'chainsaw-man.fandom.com',wakfu:'wakfu.fandom.com',
  demonslayer:'kimetsu-no-yaiba.fandom.com',kimetsu:'kimetsu-no-yaiba.fandom.com',pokemon:'pokemon.fandom.com',
  dragonball:'dragonball.fandom.com',hellsparadise:'jigokuraku.fandom.com',jigokuraku:'jigokuraku.fandom.com',
  gachakuta:'gachiakuta.fandom.com',gachiakuta:'gachiakuta.fandom.com',haikyuu:'haikyuu.fandom.com',jojo:'jojo.fandom.com',tensura:'tensura.fandom.com',
  onepunchman:'onepunchman.fandom.com',sao:'swordartonline.fandom.com',swordartonline:'swordartonline.fandom.com',
  tokyoghoul:'tokyoghoul.fandom.com',tokyo_revengers:'tokyorevengers.fandom.com',tokyorevengers:'tokyorevengers.fandom.com'
};

const report = {
  generatedAt:new Date().toISOString(), settings:{concurrency:CONCURRENCY,size:SIZE,quality:QUALITY,refresh:REFRESH},
  characterEntries:0,cachedCharacters:0,downloadedCharacters:0,resolvedCharacters:0,failedCharacters:[],
  externalFound:0,externalDownloaded:0,externalCached:0,externalFailed:[],rewrittenFiles:[],
  codeImageUrlsFound:0,codeImageUrls:[],bytesBefore:0,bytesAfter:0
};

const key = v => String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const slug = v => String(v||'unknown').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'unknown';
const hash = v => crypto.createHash('sha1').update(String(v)).digest('hex').slice(0,16);
const remote = v => typeof v === 'string' && /^https?:\/\//i.test(v);
function imageUrl(v){
  if(!remote(v)) return false;
  try { const u=new URL(v), p=u.pathname.toLowerCase(); return /\.(png|jpe?g|webp|gif|avif)(?:$|\/)/i.test(p)||u.hostname.includes('anilistcdn')||(u.hostname.includes('wikia')&&p.includes('/images/'))||u.hostname.includes('myanimelist.net'); }
  catch{return false;}
}
const repoUrl = p => '/' + path.relative(ROOT,p).split(path.sep).join('/');
async function exists(p){try{const s=await fs.stat(p);return s.isFile()&&s.size>128;}catch{return false;}}
async function readJson(p,fallback={}){try{return JSON.parse(await fs.readFile(p,'utf8'));}catch{return fallback;}}
async function writeJson(p,v){await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(v,null,2)+'\n');}
function leaves(obj,parts=[],out=[]){if(typeof obj==='string'){out.push({parts,value:obj});return out;}if(!obj||typeof obj!=='object')return out;for(const [k,v] of Object.entries(obj))leaves(v,[...parts,k],out);return out;}
function getAt(obj,parts){let r=obj;for(const p of parts)r=r?.[p];return r;}
function setAt(obj,parts,v){let r=obj;for(let i=0;i<parts.length-1;i++)r=r[parts[i]];r[parts.at(-1)]=v;}

async function fetchTimed(url,opts={},ms=18000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{redirect:'follow',...opts,signal:c.signal});}finally{clearTimeout(t);}}
async function download(url){let last;for(let i=1;i<=3;i++){try{const r=await fetchTimed(url,{headers:{'User-Agent':USER_AGENT,'Accept':'image/avif,image/webp,image/*,*/*;q=0.8','Referer':'https://anime-game-server.onrender.com/'}},16000+i*3500);if(!r.ok)throw new Error(`HTTP ${r.status}`);const type=r.headers.get('content-type')||'';const buf=Buffer.from(await r.arrayBuffer());if(buf.length<200)throw new Error(`too small (${buf.length} bytes)`);if(/text\/html|application\/json/i.test(type))throw new Error(`not image (${type})`);return{buf,type,finalUrl:r.url||url};}catch(e){last=e;if(i<3)await new Promise(r=>setTimeout(r,500*i));}}throw last;}
async function convert(url,out){const d=await download(url);const im=sharp(d.buf,{animated:false,failOn:'none'}).rotate();const meta=await im.metadata();if(!meta.width||!meta.height)throw new Error('invalid dimensions');const webp=await im.resize({width:SIZE,height:SIZE,fit:'cover',position:'attention'}).webp({quality:QUALITY,effort:5,smartSubsample:true}).toBuffer();if(webp.length<100)throw new Error('bad WebP');if(!CHECK_ONLY){await fs.mkdir(path.dirname(out),{recursive:true});const tmp=out+'.tmp';await fs.writeFile(tmp,webp);await fs.rename(tmp,out);}report.bytesBefore+=d.buf.length;report.bytesAfter+=webp.length;return{...d,width:meta.width,height:meta.height,before:d.buf.length,after:webp.length};}

async function resolveAniList(universe,name){
  const media=animeAliases[key(universe)]||String(universe).replace(/[_-]+/g,' ');
  const query=`query($media:String,$char:String){Media(search:$media,type:ANIME){characters(search:$char,perPage:10){nodes{name{full native alternative} image{large}}}}}`;
  try{const r=await fetchTimed('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','User-Agent':USER_AGENT},body:JSON.stringify({query,variables:{media,char:name}})},16000);if(r.ok){const j=await r.json(),nodes=j?.data?.Media?.characters?.nodes||[],needle=key(name);nodes.sort((a,b)=>score(b)-score(a));function score(n){const names=[n?.name?.full,n?.name?.native,...(n?.name?.alternative||[])].filter(Boolean);return Math.max(0,...names.map(x=>key(x)===needle?100:(key(x).includes(needle)||needle.includes(key(x))?60:0)));}if(nodes[0]?.image?.large)return{url:nodes[0].image.large,source:'anilist-media'};}}catch{}
  try{const q=`query($char:String){Character(search:$char){image{large}}}`;const r=await fetchTimed('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','User-Agent':USER_AGENT},body:JSON.stringify({query:q,variables:{char:name}})},16000);if(r.ok){const j=await r.json();if(j?.data?.Character?.image?.large)return{url:j.data.Character.image.large,source:'anilist-character'};}}catch{}
  return null;
}
async function resolveFandom(universe,name){const host=fandomWikis[key(universe)];if(!host)return null;const p=new URLSearchParams({action:'query',generator:'search',gsrsearch:name,gsrnamespace:'0',gsrlimit:'8',prop:'pageimages|info',piprop:'original|thumbnail',pithumbsize:'700',inprop:'url',redirects:'1',format:'json',origin:'*'});try{const r=await fetchTimed(`https://${host}/api.php?${p}`,{headers:{'User-Agent':USER_AGENT,'Accept':'application/json'}},16000);if(!r.ok)return null;const j=await r.json(),pages=Object.values(j?.query?.pages||{}),needle=key(name);pages.sort((a,b)=>rank(b)-rank(a));function rank(x){const k=key(x?.title);return k===needle?100:(k.includes(needle)||needle.includes(k)?60:0);}for(const x of pages){const url=x?.original?.source||x?.thumbnail?.source;if(url)return{url,source:'fandom',page:x?.fullurl||null};}}catch{}return null;}

async function pool(items,fn,n=CONCURRENCY){let cursor=0;await Promise.all(Array.from({length:Math.min(n,Math.max(items.length,1))},async()=>{while(true){const i=cursor++;if(i>=items.length)break;try{await fn(items[i],i);}catch(e){console.error('worker:',e.message);}}}));}
function progress(done,total,msg){if(done<5||done%25===0||done===total)console.log(`[${done}/${total}] ${msg}`);}

async function cacheCharacters(){
  const map=await readJson(CHAR_FILE,null);if(!map)throw new Error('char-images.json invalid');
  const manifest=await readJson(MANIFEST_FILE,{version:1,characters:{},external:{}});manifest.characters||={};manifest.external||={};
  const jobs=leaves(map).filter(x=>x.parts.length>=2);report.characterEntries=jobs.length;let done=0;
  await pool(jobs,async job=>{
    const universe=job.parts[0],name=job.parts.slice(1).join(' / '),id=job.parts.join('|');
    const out=path.join(CHAR_ROOT,slug(universe),slug(name)+'.webp'),local=repoUrl(out),old=manifest.characters[id]||{},current=getAt(map,job.parts);
    if(!REFRESH&&await exists(out)){if(!CHECK_ONLY)setAt(map,job.parts,local);manifest.characters[id]={...old,universe,name,localUrl:local,sourceUrl:old.sourceUrl||(remote(current)?current:null),status:'cached'};report.cachedCharacters++;done++;progress(done,jobs.length,`${universe} / ${name} cached`);return;}
    const candidates=[];const add=(url,source,page=null)=>{if(imageUrl(url)&&!candidates.some(x=>x.url===url))candidates.push({url,source,page});};add(remote(current)?current:null,'char-images');add(old.sourceUrl,'manifest');let success=null,resolved=false,errors=[];
    for(const c of candidates){try{success={...c,...await convert(c.url,out)};break;}catch(e){errors.push(`${c.source}: ${e.message}`);}}
    if(!success){const retryFrom=candidates.length;const a=await resolveAniList(universe,name);if(a)add(a.url,a.source,a.page);const f=await resolveFandom(universe,name);if(f)add(f.url,f.source,f.page);for(const c of candidates.slice(retryFrom)){try{success={...c,...await convert(c.url,out)};resolved=true;break;}catch(e){errors.push(`${c.source}: ${e.message}`);}}}
    if(success){if(!CHECK_ONLY)setAt(map,job.parts,local);manifest.characters[id]={universe,name,localUrl:local,sourceUrl:success.url,resolvedBy:success.source,sourcePage:success.page||null,finalSourceUrl:success.finalUrl||success.url,originalDimensions:[success.width,success.height],originalBytes:success.before,webpBytes:success.after,status:'ok',updatedAt:new Date().toISOString()};report.downloadedCharacters++;if(resolved)report.resolvedCharacters++;}
    else{manifest.characters[id]={...old,universe,name,localUrl:local,sourceUrl:old.sourceUrl||(remote(current)?current:null),status:'failed',errors,updatedAt:new Date().toISOString()};report.failedCharacters.push({universe,name,current,errors});}
    done++;progress(done,jobs.length,`${universe} / ${name} ${success?'ok':'FAILED'}`);
  });
  manifest.generatedAt=new Date().toISOString();if(!CHECK_ONLY){await writeJson(CHAR_FILE,map);await writeJson(MANIFEST_FILE,manifest);}return manifest;
}

async function cacheDataFiles(manifest){
  const urlRegex=/https?:\/\/[^\s'"`<>\\)]+/g;
  for(const filename of DATA_FILES){const file=path.join(ROOT,filename);let text;try{text=await fs.readFile(file,'utf8');}catch{continue;}const urls=[...new Set((text.match(urlRegex)||[]).map(x=>x.replace(/[;,]+$/,'')).filter(imageUrl))];report.externalFound+=urls.length;let changed=false,done=0;
    await pool(urls,async url=>{const out=path.join(EXTRA_ROOT,hash(url)+'.webp'),local=repoUrl(out);if(!REFRESH&&await exists(out)){report.externalCached++;manifest.external[url]={...(manifest.external[url]||{}),localUrl:local,status:'cached'};text=text.split(url).join(local);changed=true;}else{try{const info=await convert(url,out);manifest.external[url]={localUrl:local,finalSourceUrl:info.finalUrl,originalBytes:info.before,webpBytes:info.after,status:'ok',updatedAt:new Date().toISOString()};text=text.split(url).join(local);changed=true;report.externalDownloaded++;}catch(e){report.externalFailed.push({file:filename,url,error:e.message});}}done++;progress(done,urls.length,`external ${filename}`);});
    if(changed&&!CHECK_ONLY){await fs.writeFile(file,text);report.rewrittenFiles.push(filename);}
  }
  if(!CHECK_ONLY)await writeJson(MANIFEST_FILE,manifest);
}

async function walkJs(dir){try{const es=await fs.readdir(dir,{withFileTypes:true}),out=[];for(const e of es){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walkJs(p));else if(/\.(js|mjs|html)$/i.test(e.name))out.push(p);}return out;}catch{return[];}}
async function cacheCode(manifest){
  const files=[];for(const n of CODE_FILES){const p=path.join(ROOT,n);try{await fs.access(p);files.push(p);}catch{}}files.push(...await walkJs(JS_DIR));
  const rx=/https?:\/\/[^\s'"`<>\\)]+/g;
  for(const file of files){
    let text='';try{text=await fs.readFile(file,'utf8');}catch{continue;}
    const urls=[...new Set((text.match(rx)||[]).map(x=>x.replace(/[;,]+$/,'')).filter(imageUrl))];
    if(!urls.length)continue;
    let changed=false;
    for(const url of urls){
      report.codeImageUrlsFound++;
      const out=path.join(EXTRA_ROOT,hash(url)+'.webp'),local=repoUrl(out);
      let ok=false;
      if(!REFRESH&&await exists(out)){ok=true;report.externalCached++;}
      else{try{const info=await convert(url,out);manifest.external[url]={localUrl:local,finalSourceUrl:info.finalUrl,originalBytes:info.before,webpBytes:info.after,status:'ok',updatedAt:new Date().toISOString()};report.externalDownloaded++;ok=true;}catch(e){report.externalFailed.push({file:path.relative(ROOT,file),url,error:e.message});}}
      if(ok){manifest.external[url]={...(manifest.external[url]||{}),localUrl:local,status:'ok'};text=text.split(url).join(local);changed=true;}
      report.codeImageUrls.push({file:path.relative(ROOT,file),url,local:ok?local:null});
    }
    if(changed&&!CHECK_ONLY){await fs.writeFile(file,text);report.rewrittenFiles.push(path.relative(ROOT,file));}
  }
  if(!CHECK_ONLY)await writeJson(MANIFEST_FILE,manifest);
}

async function writeReports(){
  report.generatedAt=new Date().toISOString();
  if(!CHECK_ONLY){await writeJson(REPORT_FILE,report);await writeJson(MISSING_FILE,{generatedAt:report.generatedAt,characters:report.failedCharacters,external:report.externalFailed});}
  const saved=report.bytesBefore?Math.round((1-report.bytesAfter/report.bytesBefore)*100):0;
  const lines=['# Image cache report','',`Generated: ${report.generatedAt}`,'',`- Character entries: **${report.characterEntries}**`,`- Already cached: **${report.cachedCharacters}**`,`- Downloaded / converted: **${report.downloadedCharacters}**`,`- Missing images resolved automatically: **${report.resolvedCharacters}**`,`- Character failures: **${report.failedCharacters.length}**`,`- Extra JSON image URLs: **${report.externalFound}**`,`- Extra images downloaded: **${report.externalDownloaded}**`,`- Hard-coded code image URLs processed: **${report.codeImageUrlsFound}**`,`- Approx. size reduction this run: **${saved}%**`,'','## Failed characters',''];
  if(!report.failedCharacters.length)lines.push('None.');else for(const x of report.failedCharacters)lines.push(`- **${x.universe} — ${x.name}**: ${(x.errors||[]).join(' | ')||'not found'}`);
  lines.push('','## External failures','');if(!report.externalFailed.length)lines.push('None.');else for(const x of report.externalFailed)lines.push(`- **${x.file}** — ${x.url}: ${x.error}`);
  lines.push('','## Image URLs found in JS/HTML','','These are cached locally when downloadable.');for(const x of report.codeImageUrls.slice(0,400))lines.push(`- ${x.file}: ${x.url}${x.local?` -> ${x.local}`:''}`);
  if(!CHECK_ONLY)await fs.writeFile(REPORT_MD,lines.join('\n')+'\n');
}

async function main(){console.log(`Image cache: ${CONCURRENCY} workers, ${SIZE}px WebP q${QUALITY}`);await fs.mkdir(CHAR_ROOT,{recursive:true});await fs.mkdir(EXTRA_ROOT,{recursive:true});const manifest=await cacheCharacters();await cacheDataFiles(manifest);await cacheCode(manifest);await writeReports();console.log(`Done: ${report.downloadedCharacters} character images downloaded, ${report.failedCharacters.length} failed; ${report.externalDownloaded} extra images downloaded.`);if(report.failedCharacters.length)process.exitCode=2;}
main().catch(e=>{console.error(e);process.exitCode=1;});
