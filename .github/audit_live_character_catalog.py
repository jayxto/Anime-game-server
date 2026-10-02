from pathlib import Path
import json, urllib.request, urllib.error, time, collections

BASE='https://anime-game-server.onrender.com'
ENDPOINTS=[
    '/api/admin/character-catalog-persistent',
    '/api/character-catalog',
]

def fetch_json(path):
    url=BASE+path
    last=None
    for attempt in range(1,4):
        req=urllib.request.Request(url,headers={
            'User-Agent':'Mozilla/5.0 (compatible; AnimeGameCatalogAudit/1.0)',
            'Accept':'application/json',
            'Cache-Control':'no-cache',
        })
        try:
            with urllib.request.urlopen(req,timeout=90) as r:
                raw=r.read()
                return json.loads(raw.decode('utf-8')), url
        except Exception as e:
            last=e
            time.sleep(attempt*3)
    raise SystemExit(f'failed to fetch {url}: {type(last).__name__}: {last}')

data=None; used=None; errors=[]
for ep in ENDPOINTS:
    try:
        candidate,url=fetch_json(ep)
        if isinstance(candidate,dict) and isinstance(candidate.get('characters'),list):
            data=candidate; used=url; break
        errors.append(f'{ep}: unexpected shape')
    except SystemExit as e:
        errors.append(str(e))

if data is None:
    raise SystemExit('no live catalogue endpoint succeeded: '+ ' | '.join(errors))

chars=data.get('characters') or []
rows=[]
for idx,c in enumerate(chars,1):
    if not isinstance(c,dict): continue
    u=str(c.get('u') or c.get('universe') or c.get('universeKey') or '').strip()
    name=str(c.get('name') or c.get('displayName') or '').strip()
    img=str(c.get('img') or c.get('imageUrl') or '').strip()
    source=str(c.get('sourceUrl') or '').strip()
    status=str(c.get('status') or '').strip()
    manual=bool(c.get('manualOverride'))
    rows.append({'i':idx,'u':u,'name':name,'img':img,'sourceUrl':source,'status':status,'manualOverride':manual})

by_u=collections.Counter(r['u'] or '(unknown)' for r in rows)
missing=[r for r in rows if not r['img']]
manual=[r for r in rows if r['manualOverride'] or r['status']=='manual-admin']

# Same exact image attached to multiple different character names can indicate bad fallback/duplicate portraits.
by_img=collections.defaultdict(list)
for r in rows:
    if r['img']:
        by_img[r['img']].append(r)
dups=[]
for img,grp in by_img.items():
    names={(x['u'],x['name']) for x in grp}
    if len(names)>1:
        dups.append({'img':img,'count':len(names),'characters':sorted([{'u':u,'name':n} for u,n in names], key=lambda x:(x['u'],x['name']))})
dups.sort(key=lambda x:(-x['count'],x['img']))

report={
    'sourceEndpoint':used,
    'ok':data.get('ok'),
    'total':len(rows),
    'universes':dict(sorted(by_u.items())),
    'missingCount':len(missing),
    'manualOverrideCount':len(manual),
    'duplicateImageGroupCount':len(dups),
    'missing':missing,
    'duplicateImages':dups,
    'characters':rows,
}
Path('.github/live_character_catalog_audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
summary=[
    f'ENDPOINT={used}',
    f'TOTAL={len(rows)} UNIVERSES={len(by_u)} MISSING={len(missing)} MANUAL={len(manual)} DUP_IMAGE_GROUPS={len(dups)}',
    '', '=== UNIVERSES ==='
]
summary += [f'{u}: {n}' for u,n in sorted(by_u.items())]
summary += ['', '=== MISSING ===']
summary += [f"{r['u']} | {r['name']} | status={r['status']}" for r in missing]
summary += ['', '=== DUPLICATE IMAGE GROUPS (top 100) ===']
for d in dups[:100]:
    summary.append(f"{d['count']}x {d['img']} :: " + ' ; '.join(f"{x['u']}/{x['name']}" for x in d['characters']))
Path('.github/live_character_catalog_summary.txt').write_text('\n'.join(summary),encoding='utf-8')
print(summary[1])
