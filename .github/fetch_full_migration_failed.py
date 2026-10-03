from pathlib import Path
import json, urllib.request

URL='https://anime-game-server.onrender.com/api/image-migration-status'
req=urllib.request.Request(URL,headers={'User-Agent':'AnimeGameAudit/1.0','Accept':'application/json','Cache-Control':'no-cache'})
with urllib.request.urlopen(req,timeout=60) as r:
    d=json.loads(r.read().decode('utf-8'))
Path('.github/full_migration_failed.json').write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
failed=d.get('failed') or []
lines=[f"running={d.get('running')} done={d.get('done')} pass={d.get('pass')} total={d.get('total')} stored={d.get('stored')} missing={d.get('missing')} failed={len(failed)}",'']
for i,x in enumerate(failed,1):
    lines.append(f"{i:04d} | {x.get('u','')} | {x.get('anime','')} | {x.get('name','')}")
Path('.github/full_migration_failed.txt').write_text('\n'.join(lines),encoding='utf-8')
print(lines[0])
