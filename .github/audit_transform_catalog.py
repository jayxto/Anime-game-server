from pathlib import Path
import re, base64, json

s = Path('server.js').read_text(encoding='utf-8')
out=[]
out.append('=== QAP TRANSFORMATION CATALOG DECODE ===')
out.append(f'server_chars={len(s)}')

# Decode the embedded qap-themes.json from SIMPLE EMBEDDED DATA FILES V1.
m = re.search(r'"qap-themes\.json"\s*:\s*"([A-Za-z0-9+/=]+)"', s)
if not m:
    raise SystemExit('embedded qap-themes.json not found')
raw = base64.b64decode(m.group(1)).decode('utf-8')
data = json.loads(raw)
themes = data.get('themes') or []
t = next((x for x in themes if x.get('id') == 'transformation'), None)
if not t:
    raise SystemExit('transformation theme not found')
items = t.get('items') or []
out.append(f'theme_title={t.get("title")!r}')
out.append(f'item_count={len(items)}')
out.append('\n=== ITEMS ===')
for i,it in enumerate(items,1):
    out.append(json.dumps({
        'i': i,
        'name': it.get('name'),
        'char': it.get('char'),
        'sub': it.get('sub'),
        'img': it.get('img'),
        'imageSearch': it.get('imageSearch'),
        'media': it.get('media')
    }, ensure_ascii=False, sort_keys=True))

# Decode current verified rows in source into a compact section for direct comparison.
vm=re.search(r"const\s+QAP_VERIFIED_TRANSFORM_SOURCES_V2\s*=\s*\[(.*?)\n\];",s,re.S)
out.append('\n=== VERIFIED SOURCE ARRAY ===')
out.append(vm.group(1) if vm else 'NOT FOUND')

# Alias table, useful for forms not explicitly seeded.
am=re.search(r"const\s+TRANSFORM_PAGE_ALIASES\s*=\s*\{(.*?)\n\};",s,re.S)
out.append('\n=== ALIASES ===')
out.append(am.group(1) if am else 'NOT FOUND')

Path('.github/transform_audit.txt').write_text('\n'.join(out),encoding='utf-8')
print('decoded transformation items:', len(items))
