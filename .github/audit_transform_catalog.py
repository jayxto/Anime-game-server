from pathlib import Path
import re, base64, json

s=Path('server.js').read_text(encoding='utf-8')
m=re.search(r'"qap-themes\.json"\s*:\s*"([A-Za-z0-9+/=]+)"',s)
if not m: raise SystemExit('embedded qap-themes.json not found')
data=json.loads(base64.b64decode(m.group(1)).decode('utf-8'))
t=next((x for x in (data.get('themes') or []) if x.get('id')=='transformation'),None)
if not t: raise SystemExit('transformation theme not found')
items=t.get('items') or []

def line(i,it):
    return json.dumps({'i':i,'name':it.get('name'),'char':it.get('char'),'sub':it.get('sub'),'img':it.get('img'),'imageSearch':it.get('imageSearch')},ensure_ascii=False,sort_keys=True)

for a,b in [(1,35),(36,70),(71,105)]:
    rows=[f'=== ITEMS {a}-{b} / total {len(items)} ===']
    for i in range(a,min(b,len(items))+1): rows.append(line(i,items[i-1]))
    Path(f'.github/transform_items_{a:03d}_{b:03d}.txt').write_text('\n'.join(rows),encoding='utf-8')
print('chunked transformation items:',len(items))
