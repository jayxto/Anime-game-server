from pathlib import Path
import json, time, urllib.request

BASE='https://anime-game-server.onrender.com'

def get(path):
    req=urllib.request.Request(BASE+path,headers={'User-Agent':'AnimeGameMigrationWatch/1.0','Accept':'application/json','Cache-Control':'no-cache'})
    with urllib.request.urlopen(req,timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))

last=None
for i in range(60):
    try:
        last=get('/api/image-migration-status')
    except Exception as e:
        last={'ok':False,'error':str(e)}
    print('poll',i+1,'running=',last.get('running'),'pass=',last.get('pass'),'missing=',last.get('missing'),'failed=',len(last.get('failed') or []),flush=True)
    if last.get('running') is False:
        break
    time.sleep(12)

stats={}
try: stats=get('/api/character-image-stats')
except Exception as e: stats={'error':str(e)}

report={'migration':last,'stats':stats,'capturedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
Path('.github/final_image_migration_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
lines=[
    f"running={last.get('running')} done={last.get('done')} pass={last.get('pass')} total={last.get('total')} stored={last.get('stored')} missing={last.get('missing')} failed_count={len(last.get('failed') or [])}",
    f"db_total={stats.get('total')} db_ok={stats.get('ok')} db_missing={stats.get('missing')} db_error={stats.get('error')}",
    '', '=== FINAL FAILED / UNRESOLVED ==='
]
for x in (last.get('failed') or []):
    lines.append(json.dumps(x,ensure_ascii=False,sort_keys=True))
Path('.github/final_image_migration_report.txt').write_text('\n'.join(lines),encoding='utf-8')
print('\n'.join(lines[:2]))
