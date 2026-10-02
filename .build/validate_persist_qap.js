const fs=require('fs');
const vm=require('vm');

const html=fs.readFileSync('index.html','utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
let checked=0;
for(const m of scripts){
  if(/application\/ld\+json/i.test(m[1]||'')) continue;
  const code=m[2]||'';
  if(!code.trim()) continue;
  try { new vm.Script(code); checked++; }
  catch(e){ console.error('HTML script syntax error in block',checked+1,e.message); process.exit(1); }
}
console.log('HTML_SCRIPT_SYNTAX_OK',checked);

const a=html.indexOf('const QAP_CATS');
const b=html.indexOf('let qapCats',a);
if(a<0||b<a) throw new Error('QAP definitions missing');
const defs=html.slice(a,b);
const checks=`
if(QAP_QUESTIONS.length!==64) throw new Error('Expected 64 QAP questions, got '+QAP_QUESTIONS.length);
if(QAP_SUB_OF.length!==QAP_QUESTIONS.length) throw new Error('QAP subcategory count mismatch');
if(QAP_SUB_OF.some(x=>!x||x.endsWith(':other'))) throw new Error('At least one QAP question has no subcategory');
console.log('QAP_COVERAGE_OK',QAP_SUB_OF.length+'/'+QAP_QUESTIONS.length);
`;
new vm.Script(`(()=>{${defs}\n${checks}})()`).runInNewContext({console});

const server=fs.readFileSync('server.js','utf8');
for(const marker of ['AG_MANUAL_IMAGE_PRIORITY_V3','AG_MANUAL_IMAGE_LOCK_V3','AG_MANUAL_CATALOG_PRIORITY_V3']) {
  if(!server.includes(marker)) throw new Error('Missing '+marker);
}
if(!server.includes("status='manual-admin'")) throw new Error('manual-admin priority missing');
if(!server.includes('manualImage: true')) throw new Error('catalog manual flag missing');
if(!html.includes("['qap', '🏆 Qui a le plus']")) throw new Error('top level QAP category missing');
if(!html.includes('qap_subcats')) throw new Error('QAP subcategory persistence missing');
console.log('PERSISTENCE_QAP_STRUCTURE_OK');
