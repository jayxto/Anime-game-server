from pathlib import Path
import json, urllib.request

BASE='https://anime-game-server.onrender.com'
def get(path):
    req=urllib.request.Request(BASE+path,headers={'User-Agent':'AnimeGameImageStats/1.0','Accept':'application/json','Cache-Control':'no-cache'})
    with urllib.request.urlopen(req,timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))

stats=get('/api/character-image-stats')
migration=get('/api/image-migration-status')
out={'stats':stats,'migration':migration}
Path('.github/current_image_stats.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
lines=[
    f"DB persistent={stats.get('persistent')} total={stats.get('total')} ok={stats.get('ok')} missing={stats.get('missing')} error={stats.get('error')} memory={stats.get('cachedInMemory')}",
    f"MIGRATION running={migration.get('running')} done={migration.get('done')} pass={migration.get('pass')} total={migration.get('total')} stored={migration.get('stored')} missing={migration.get('missing')} failed_count={len(migration.get('failed') or [])}",
]
for x in (migration.get('failed') or [])[:300]:
    lines.append(str(x))
Path('.github/current_image_stats_summary.txt').write_text('\n'.join(lines),encoding='utf-8')
print('\n'.join(lines[:2]))
