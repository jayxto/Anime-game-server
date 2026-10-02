from pathlib import Path
import json, time, urllib.request, urllib.error

URL='https://anime-game-server.onrender.com/api/character-image-health'
last=None
for attempt in range(1,16):
    try:
        req=urllib.request.Request(URL,headers={'User-Agent':'AnimeGameImageHealth/1.0','Accept':'application/json','Cache-Control':'no-cache'})
        with urllib.request.urlopen(req,timeout=45) as r:
            data=json.loads(r.read().decode('utf-8'))
        if isinstance(data,dict) and data.get('ok') is True and 'state' in data:
            Path('.github/live_image_health.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
            totals=data.get('totals') or {}
            state=data.get('state') or {}
            miss=data.get('missing') or []
            lines=[
                f"DB={data.get('db')} ROWS={totals.get('rows',0)} WITH_BYTES={totals.get('with_bytes',0)} MISSING_COUNT={data.get('missingCount',0)} MANUAL={totals.get('manual',0)}",
                f"MIGRATION running={state.get('running')} done={state.get('done')} total={state.get('total')} current={state.get('current')} saved={state.get('saved')} missing={state.get('missing')}",
                '', '=== STATUS COUNTS ==='
            ]
            for x in data.get('counts') or []:
                lines.append(f"{x.get('status','')}: rows={x.get('n',0)} with_bytes={x.get('with_bytes',0)}")
            lines += ['', '=== MISSING BYTES (max 500) ===']
            for x in miss:
                lines.append(f"{x.get('u','')} | {x.get('name','')} | {x.get('status','')}")
            Path('.github/live_image_health_summary.txt').write_text('\n'.join(lines),encoding='utf-8')
            print(lines[0]); raise SystemExit(0)
        last=f'unexpected payload: {type(data).__name__}'
    except Exception as e:
        last=f'{type(e).__name__}: {e}'
    print(f'attempt {attempt}/15: {last}')
    time.sleep(20)
raise SystemExit(f'health endpoint unavailable after retries: {last}')
