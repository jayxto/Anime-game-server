from pathlib import Path
import re, json, urllib.request, urllib.error, ssl
from concurrent.futures import ThreadPoolExecutor, as_completed

s=Path('server.js').read_text(encoding='utf-8')
vm=re.search(r'const\s+QAP_VERIFIED_TRANSFORM_SOURCES_V2\s*=\s*\[(.*?)\n\];',s,re.S)
if not vm: raise SystemExit('verified source array not found')
block=vm.group(1)
rows=[]
for om in re.finditer(r'\{([^{}]*?needs\s*:\s*\[[^\]]*\][^{}]*?url\s*:\s*[\'\"][^\'\"]+[\'\"][^{}]*?)\}',block,re.S):
    obj=om.group(1)
    nm=re.search(r'needs\s*:\s*\[([^\]]*)\]',obj,re.S)
    um=re.search(r'url\s*:\s*[\'\"]([^\'\"]+)[\'\"]',obj,re.S)
    if not nm or not um: continue
    needs=re.findall(r'[\'\"]([^\'\"]+)[\'\"]',nm.group(1))
    rows.append({'needs':needs,'url':um.group(1)})

by_url={}
for r in rows:
    by_url.setdefault(r['url'],[]).append(r['needs'])

ctx=ssl.create_default_context()

def magic_ok(data):
    return (
        data.startswith(b'\xff\xd8\xff') or
        data.startswith(b'\x89PNG\r\n\x1a\n') or
        data.startswith(b'GIF87a') or data.startswith(b'GIF89a') or
        (len(data)>=12 and data[:4]==b'RIFF' and data[8:12]==b'WEBP')
    )

def check(url):
    headers={
        'User-Agent':'Mozilla/5.0 (compatible; AnimeGameImageAudit/1.0)',
        'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Range':'bytes=0-8191',
    }
    req=urllib.request.Request(url,headers=headers,method='GET')
    try:
        with urllib.request.urlopen(req,timeout=12,context=ctx) as resp:
            status=getattr(resp,'status',200)
            ctype=(resp.headers.get('Content-Type') or '').lower()
            final=resp.geturl()
            data=resp.read(8192)
            ok=(200 <= status < 400) and (ctype.startswith('image/') or magic_ok(data))
            reason=f'HTTP {status} {ctype or "no-content-type"}'
            if not ok and 'text/html' in ctype: reason += ' (HTML, not image)'
            return {'url':url,'ok':ok,'status':status,'contentType':ctype,'finalUrl':final,'reason':reason}
    except urllib.error.HTTPError as e:
        return {'url':url,'ok':False,'status':e.code,'contentType':str(e.headers.get('Content-Type') or ''),'finalUrl':url,'reason':f'HTTP {e.code}'}
    except Exception as e:
        return {'url':url,'ok':False,'status':None,'contentType':'','finalUrl':url,'reason':f'{type(e).__name__}: {e}'}

results=[]
with ThreadPoolExecutor(max_workers=12) as ex:
    futs={ex.submit(check,u):u for u in by_url}
    for fut in as_completed(futs):
        r=fut.result(); r['needs']=by_url[r['url']]; results.append(r)

results.sort(key=lambda x:(x['ok'], x['url']))
ok=[r for r in results if r['ok']]
fail=[r for r in results if not r['ok']]
out=[f'ROWS={len(rows)} UNIQUE_URLS={len(results)} OK={len(ok)} FAIL={len(fail)}','', '=== FAIL ===']
out += [json.dumps(r,ensure_ascii=False,sort_keys=True) for r in fail]
out += ['', '=== OK ===']
out += [json.dumps(r,ensure_ascii=False,sort_keys=True) for r in ok]
Path('.github/transform_source_health.txt').write_text('\n'.join(out),encoding='utf-8')
print(out[0])
# Do not fail the workflow solely because remote hosts block CI; report is diagnostic.
