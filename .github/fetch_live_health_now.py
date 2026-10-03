from pathlib import Path
import json, time, urllib.request

URL='https://anime-game-server.onrender.com/api/character-image-health'
last_err=None
data=None
for i in range(1,13):
    try:
        req=urllib.request.Request(URL,headers={
            'User-Agent':'AnimeGameImageAudit/1.0',
            'Accept':'application/json',
            'Cache-Control':'no-cache',
        })
        with urllib.request.urlopen(req,timeout=60) as r:
            candidate=json.loads(r.read().decode('utf-8'))
        if candidate.get('ok') is True:
            data=candidate
            print('health fetched on attempt',i)
            break
    except Exception as e:
        last_err=e
        print('attempt',i,type(e).__name__,e)
    time.sleep(10)
if data is None:
    raise SystemExit(f'live health unavailable: {last_err}')

Path('.github/live_image_health_now.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
t=data.get('totals') or {}; s=data.get('state') or {}
lines=[
    f"DB rows={t.get('rows',0)} bytes={t.get('with_bytes',0)} db_missing={data.get('missingCount',0)} manual={t.get('manual',0)}",
    f"Catalogue total={data.get('catalogueTotal','n/a')} stored={data.get('catalogueStored','n/a')} missing={data.get('catalogueMissingCount','n/a')}",
    f"Migration running={s.get('running')} done={s.get('done')} pass={s.get('pass')} total={s.get('total')} stored={s.get('stored')} missing={s.get('missing')}",
    '', '=== CATALOGUE MISSING ==='
]
for x in data.get('catalogueMissing') or []:
    lines.append(f"{x.get('u','')} | {x.get('name','')} | {x.get('anime','')} | sources={','.join(x.get('sources') or [])}")
lines += ['', '=== DB MISSING BYTES ===']
for x in data.get('missing') or []:
    lines.append(f"{x.get('u','')} | {x.get('name','')} | status={x.get('status','')}")
Path('.github/live_image_health_now.txt').write_text('\n'.join(lines),encoding='utf-8')
print(lines[0])
print(lines[1])
print(lines[2])
