from pathlib import Path
import json,time,urllib.request
URL='https://anime-game-server.onrender.com/api/image-migration-status'
last={}
for i in range(1,91):
    try:
        req=urllib.request.Request(URL,headers={'User-Agent':'AnimeGameMigrationAudit/1.0','Accept':'application/json','Cache-Control':'no-cache'})
        with urllib.request.urlopen(req,timeout=45) as r:
            d=json.loads(r.read().decode('utf-8'))
        last=d
        failed=d.get('failed') or []
        print(f"attempt={i} running={d.get('running')} pass={d.get('pass')} stored={d.get('stored')} missing={d.get('missing')} failed={len(failed)}")
        if failed or d.get('running') is False:
            lines=[f"running={d.get('running')} done={d.get('done')} pass={d.get('pass')} total={d.get('total')} stored={d.get('stored')} missing={d.get('missing')} failed={len(failed)}",'']
            for x in failed: lines.append(f"{x.get('u','')} | {x.get('anime','')} | {x.get('name','')}")
            Path('.github/migration_failed_now.txt').write_text('\n'.join(lines),encoding='utf-8')
            Path('.github/migration_failed_now.json').write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
            raise SystemExit(0)
    except SystemExit: raise
    except Exception as e:
        print(type(e).__name__,e)
    time.sleep(10)
Path('.github/migration_failed_now.json').write_text(json.dumps(last,ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit('migration did not finish within poll window')
