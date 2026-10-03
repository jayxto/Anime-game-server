from pathlib import Path
import json, time, urllib.request, urllib.error, collections

URL='https://anime-game-server.onrender.com/api/character-image-missing-list'
data=None
last=None
for i in range(30):
    try:
        req=urllib.request.Request(URL,headers={'User-Agent':'AnimeGameMissingAudit/1.0','Accept':'application/json','Cache-Control':'no-cache'})
        with urllib.request.urlopen(req,timeout=90) as r:
            candidate=json.loads(r.read().decode('utf-8'))
        if candidate.get('ok') and isinstance(candidate.get('missing'),list):
            data=candidate
            break
        last=f'unexpected payload: {candidate}'
    except Exception as e:
        last=f'{type(e).__name__}: {e}'
    print('attempt',i+1,'waiting for endpoint:',last,flush=True)
    time.sleep(12)
if data is None:
    raise SystemExit('missing endpoint did not become ready: '+str(last))

missing=data.get('missing') or []
by=collections.defaultdict(list)
for x in missing:
    by[str(x.get('u') or '(unknown)')].append(x)

Path('.github/full_missing_image_list.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
lines=[f"TOTAL={data.get('total')} STORED={data.get('stored')} MISSING={data.get('missingCount')}",'']
for u in sorted(by):
    lines.append(f'=== {u} ({len(by[u])}) ===')
    for x in sorted(by[u],key=lambda z:str(z.get('name') or '')):
        lines.append(json.dumps(x,ensure_ascii=False,sort_keys=True))
    lines.append('')
Path('.github/full_missing_image_list.txt').write_text('\n'.join(lines),encoding='utf-8')
print(lines[0])
