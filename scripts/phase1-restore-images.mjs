import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { spawn } from 'child_process';

const ROOT=process.cwd();
const CATALOG='/tmp/ag-image-catalog.json';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const exts=['.webp','.png','.jpg','.jpeg','.gif'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function patchServer(){
  const p='server.js'; let s=fs.readFileSync(p,'utf8');
  if(s.includes('AG_CANONICAL_IMAGE_BRIDGE_V1')) return;
  const needle='const app = express();';
  if(!s.includes(needle)) throw new Error('Express app declaration not found');
  const bridge=`\n// AG_CANONICAL_IMAGE_BRIDGE_V1\nconst AG_CANONICAL_IMAGE_ROOT = path.join(__dirname, 'music', 'char-images');\nconst AG_LEGACY_IMAGE_ROOT = path.join(__dirname, 'music', 'legacy-images');\nfunction agCanonicalImageSlug(v){ return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }\nfunction agTrySendCanonicalImage(req,res,next){ try { const u=agCanonicalImageSlug(req.query&&req.query.u)||'_global'; const n=agCanonicalImageSlug(req.query&&(req.query.n||req.query.name)); if(!n)return next(); const base=path.resolve(AG_CANONICAL_IMAGE_ROOT,u); for(const ext of ['.webp','.png','.jpg','.jpeg']){ const f=path.resolve(base,n+ext); if(f.startsWith(base+path.sep)&&fs.existsSync(f)&&fs.statSync(f).size>512){ res.set('Cache-Control','public, max-age=31536000, immutable'); return res.sendFile(f); } } }catch(_){} return next(); }\napp.use('/api/avatar/img',agTrySendCanonicalImage);\napp.use('/api/character-image',agTrySendCanonicalImage);\napp.use(/^\\/assets\\/images\\/(.*)$/,(req,res,next)=>{ try { const rel=String(req.params[0]||'').replace(/^[/\\\\]+/,''); const root=path.resolve(AG_LEGACY_IMAGE_ROOT); const f=path.resolve(root,rel); if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile()){ res.set('Cache-Control','public, max-age=31536000, immutable'); return res.sendFile(f); } }catch(_){} next(); });\n// AG_CANONICAL_IMAGE_BRIDGE_V1_END\n`;
  fs.writeFileSync(p,s.replace(needle,needle+bridge));
}

async function boot(){
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3099'},stdio:['ignore',fs.openSync('/tmp/ag-server.log','a'),fs.openSync('/tmp/ag-server.log','a')]});
  for(let i=0;i<90;i++){
    try{const r=await fetch('http://127.0.0.1:3099/api/character-catalog'); if(r.ok){fs.writeFileSync(CATALOG,await r.text()); return child;}}catch{}
    await sleep(1000);
  }
  child.kill(); throw new Error('Server did not expose catalog');
}

function getUnique(){
  const data=JSON.parse(fs.readFileSync(CATALOG,'utf8')); const chars=data.characters||data.items||data.catalog||[]; const m=new Map();
  for(const x of chars){const u=x.universeKey||x.universe||x.u||x.key||x.animeKey||''; const n=x.name||x.character||x.displayName||x.label||''; if(n)m.set(norm(u)+'|'+norm(n),{...x,u,n});}
  return m;
}
function outPath(x){return path.join('music','char-images',norm(x.u)||'_global',norm(x.n)+'.webp');}
function hasCanonical(x){const dir=path.dirname(outPath(x)),b=norm(x.n); return exts.some(e=>{const f=path.join(dir,b+e);return fs.existsSync(f)&&fs.statSync(f).size>700;});}
function legacyPath(url){if(!url||typeof url!=='string'||!url.startsWith('/assets/images/'))return null; let rel;try{rel=decodeURIComponent(url.split('?')[0].slice('/assets/images/'.length));}catch{return null;} const root=path.resolve('music','legacy-images'),f=path.resolve(root,rel.replace(/^[/\\]+/,'')); return f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile()?f:null;}
async function saveCanonical(x,input){const out=outPath(x);fs.mkdirSync(path.dirname(out),{recursive:true});const tmp=out+'.tmp-'+process.pid;try{await sharp(input,{animated:false}).rotate().resize({width:640,height:896,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toFile(tmp);if(fs.statSync(tmp).size<700)throw new Error('small');fs.renameSync(tmp,out);return true;}catch{try{fs.rmSync(tmp,{force:true});}catch{}return false;}}

async function main(){
  patchServer();
  const child=await boot();
  try{
    const uniq=getUnique(); let already=0,legacy=0;
    for(const x of uniq.values()){if(hasCanonical(x)){already++;continue;}const src=legacyPath(x.originalImg);if(src&&await saveCanonical(x,src))legacy++;}
    const direct=[...uniq.values()].filter(x=>!hasCanonical(x)&&/^https?:\/\//i.test(String(x.originalImg||'')));
    let i=0,httpOk=0,httpFail=0;
    async function worker(){while(true){const k=i++;if(k>=direct.length)return;const x=direct[k];const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);try{const r=await fetch(x.originalImg,{redirect:'follow',signal:ctrl.signal,headers:{'User-Agent':'Mozilla/5.0 AnimeGameImageLocalizer/1.0','Accept':'image/*'}});if(!r.ok)throw new Error();const b=Buffer.from(await r.arrayBuffer());if(b.length<700)throw new Error();if(await saveCanonical(x,b))httpOk++;else httpFail++;}catch{httpFail++;}finally{clearTimeout(timer);}}}
    await Promise.all(Array.from({length:12},worker));
    let canonical=0;const missing=[];for(const x of uniq.values()){if(hasCanonical(x))canonical++;else missing.push({u:x.u,n:x.n,anime:x.anime||'',sources:x.sources||[]});}
    const report={total:uniq.size,alreadyBefore:already,copiedFromLegacy:legacy,httpCandidates:direct.length,httpLocalized:httpOk,httpFailed:httpFail,canonical,missing:missing.length,coverage:Number((canonical*100/uniq.size).toFixed(2)),missingFirst500:missing.slice(0,500)};
    fs.writeFileSync('PHASE1_IMAGE_REPORT.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{child.kill();}
}
main().catch(e=>{console.error(e);process.exit(1);});
