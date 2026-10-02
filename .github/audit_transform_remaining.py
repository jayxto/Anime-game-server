from pathlib import Path
import re, base64, json, unicodedata

s=Path('server.js').read_text(encoding='utf-8')

def norm(v):
    v=str(v or '').lower()
    v=''.join(c for c in unicodedata.normalize('NFKD',v) if not unicodedata.combining(c))
    v=v.replace('’',"'").replace('–','-').replace('—','-')
    v=re.sub(r'[^a-z0-9%?+]+',' ',v)
    return re.sub(r'\s+',' ',v).strip()

# Decode exact transformation catalog
m=re.search(r'"qap-themes\\.json"\s*:\s*"([A-Za-z0-9+/=]+)"',s)
if not m: raise SystemExit('embedded qap-themes.json not found')
data=json.loads(base64.b64decode(m.group(1)).decode('utf-8'))
t=next((x for x in (data.get('themes') or []) if x.get('id')=='transformation'),None)
if not t: raise SystemExit('transformation theme not found')
items=t.get('items') or []

# Parse verified source rows from JS
vm=re.search(r'const\s+QAP_VERIFIED_TRANSFORM_SOURCES_V2\s*=\s*\[(.*?)\n\];',s,re.S)
if not vm: raise SystemExit('verified source array not found')
block=vm.group(1)
rows=[]
for rm in re.finditer(r"\{\s*needs\s*:\s*\[([^\]]*)\]\s*,\s*url\s*:\s*['\"]([^'\"]+)['\"]\s*\}",block,re.S):
    needs=re.findall(r"['\"]([^'\"]+)['\"]",rm.group(1))
    rows.append({'needs':needs,'url':rm.group(2)})

covered=[]; missing=[]
for i,it in enumerate(items,1):
    hay=norm(' | '.join(str(it.get(k) or '') for k in ('char','name','sub','imageSearch')))
    matches=[]
    for r in rows:
        ns=[norm(x) for x in r['needs']]
        if ns and all(n in hay for n in ns): matches.append(r)
    rec={
        'i':i,'char':it.get('char'),'name':it.get('name'),'sub':it.get('sub'),
        'img':it.get('img'),'imageSearch':it.get('imageSearch'),
        'matchedNeeds':[r['needs'] for r in matches],
        'matchedUrls':[r['url'] for r in matches],
    }
    (covered if matches else missing).append(rec)

out=[]
out.append(f'TOTAL={len(items)} VERIFIED_ROWS={len(rows)} COVERED={len(covered)} MISSING={len(missing)}')
out.append('\n=== MISSING VERIFIED SOURCE ===')
for x in missing: out.append(json.dumps(x,ensure_ascii=False,sort_keys=True))
out.append('\n=== COVERED ===')
for x in covered: out.append(json.dumps(x,ensure_ascii=False,sort_keys=True))
Path('.github/remaining_transform_report.txt').write_text('\n'.join(out),encoding='utf-8')
print(out[0])
