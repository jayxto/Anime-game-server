from pathlib import Path
import re, urllib.parse

s=Path('server.js').read_text(encoding='utf-8')
start=s.find('const SIMPLE_VERIFIED_CHARACTER_IMAGES = new Map(Object.entries({')
helper=s.find('function simpleVerifiedCharacterImage(u,name)', start)
if start < 0 or helper < 0:
    raise SystemExit('verified character image map not found')
block=s[start:helper]
rows=[]
for m in re.finditer(r"['\"]([^'\"]+\|[^'\"]+)['\"]\s*:\s*['\"](https?://[^'\"]+)['\"]",block):
    key,url=m.group(1),m.group(2)
    host=urllib.parse.urlparse(url).netloc.lower()
    rows.append((key,host,url))
rows=sorted(dict((k,(h,u)) for k,h,u in rows).items())
out=[f'ROWS={len(rows)}']
for key,(host,url) in rows:
    out.append(f'{key}\t{host}\t{url}')
Path('.github/verified_character_sources_current.txt').write_text('\n'.join(out),encoding='utf-8')
print(out[0])
