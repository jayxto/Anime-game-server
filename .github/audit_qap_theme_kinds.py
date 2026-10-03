from pathlib import Path
import re,base64,json
s=Path('server.js').read_text(encoding='utf-8')
m=re.search(r'"qap-themes\.json"\s*:\s*"([A-Za-z0-9+/=]+)"',s)
if not m: raise SystemExit('qap themes embedded blob not found')
d=json.loads(base64.b64decode(m.group(1)).decode('utf-8'))
lines=[]
for i,t in enumerate(d.get('themes') or [],1):
    items=t.get('items') or []
    medias={str(x.get('media') or '') for x in items if isinstance(x,dict)}
    chars=sum(1 for x in items if isinstance(x,dict) and x.get('char'))
    lines.append(json.dumps({'i':i,'id':t.get('id'),'title':t.get('title'),'kind':t.get('kind'),'items':len(items),'withChar':chars,'medias':sorted(medias)},ensure_ascii=False))
Path('.github/qap_theme_kinds.txt').write_text('\n'.join(lines),encoding='utf-8')
print('themes',len(lines))
