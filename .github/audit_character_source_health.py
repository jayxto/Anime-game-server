from pathlib import Path
import re, json, urllib.request, urllib.error, time

s=Path('server.js').read_text(encoding='utf-8')
start=s.find('const SIMPLE_VERIFIED_CHARACTER_IMAGES = new Map(Object.entries({')
helper=s.find('function simpleVerifiedCharacterImage(u,name)', start)
if start < 0 or helper < 0:
    raise SystemExit('verified character image map not found')
block=s[start:helper]

rows=[]
for m in re.finditer(r"['\"]([^'\"]+\|[^'\"]+)['\"]\s*:\s*['\"](https?://[^'\"]+)['\"]", block):
    rows.append({'key':m.group(1),'url':m.group(2)})

by_url={}
for row in rows:
    by_url.setdefault(row['url'],[]).append(row['key'])

results=[]
for i,(url,keys) in enumerate(sorted(by_url.items()),1):
    ok=False; status=None; ctype=''; final=url; reason=''; attempts=0
    for method in ('GET','HEAD'):
        attempts+=1
        try:
            headers={'User-Agent':'Mozilla/5.0 AnimeGameImageAudit/1.0','Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}
            if method=='GET': headers['Range']='bytes=0-2047'
            req=urllib.request.Request(url,headers=headers,method=method)
            with urllib.request.urlopen(req,timeout=18) as r:
                status=getattr(r,'status',200)
                ctype=(r.headers.get('Content-Type') or '').split(';')[0].lower()
                final=r.geturl()
                # Some CDNs omit image content-type on HEAD; GET content-type is authoritative.
                if 200 <= status < 400 and (ctype.startswith('image/') or method=='HEAD'):
                    ok=True; reason=f'HTTP {status} {ctype}'.strip(); break
                reason=f'HTTP {status} {ctype}'.strip()
        except urllib.error.HTTPError as e:
            status=e.code; reason=f'HTTP {e.code}'
        except Exception as e:
            reason=type(e).__name__+': '+str(e)[:160]
    results.append({'url':url,'keys':keys,'ok':ok,'status':status,'contentType':ctype,'finalUrl':final,'reason':reason,'attempts':attempts})
    if i % 25 == 0: time.sleep(0.2)

fails=[x for x in results if not x['ok']]
oks=[x for x in results if x['ok']]
out=[f'ROWS={len(rows)} UNIQUE_URLS={len(results)} OK={len(oks)} FAIL={len(fails)}','', '=== FAIL ===']
out += [json.dumps(x,ensure_ascii=False,sort_keys=True) for x in fails]
out += ['', '=== OK ===']
out += [json.dumps(x,ensure_ascii=False,sort_keys=True) for x in oks]
Path('.github/character_source_health.txt').write_text('\n'.join(out),encoding='utf-8')
print(out[0])
