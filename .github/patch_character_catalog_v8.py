from pathlib import Path
import re

p=Path('server.js')
s=p.read_text(encoding='utf-8')

# 1) QAP contains non-character themes that were polluting /api/character-catalog.
marker='CHARACTER_CATALOG_QAP_FILTER_V8'
if marker not in s:
    route_start=s.find("app.get('/api/character-catalog'")
    if route_start < 0:
        raise SystemExit('character-catalog route not found')
    route_end=s.find("app.get('/api/admin/character-catalog-persistent'", route_start)
    if route_end < 0:
        route_end=min(len(s), route_start+60000)
    segment=s[route_start:route_end]
    rx=re.compile(r"(if\s*\(\s*theme\.kind\s*!==\s*['\"]chars['\"]\s*\)\s*continue;\s*)(for\s*\(\s*const\s+item\s+of\s*\(\s*theme\.items\s*\|\|\s*\[\]\s*\)\s*\)\s*\{)")
    m=rx.search(segment)
    if not m:
        raise SystemExit('QAP character-catalog loop anchor not found inside route')
    insert="""// CHARACTER_CATALOG_QAP_FILTER_V8 — forms/arcs/anime titles are not normal character portraits.\n                    if (file === 'qap-themes.json' && ['transformation','arc','isekai','shonen','anime'].includes(String(theme.id || ''))) continue;\n                    """
    patched=segment[:m.start()] + m.group(1) + insert + m.group(2) + segment[m.end():]
    s=s[:route_start]+patched+s[route_end:]

# 2) Replace the dead 403 Ukyo source with a visually checked anime frame.
ukyo_new='https://times-abema.ismcdn.jp/mwimgs/3/3/724w/img_33316d797bfecc3a90883fc92118ffc473569.jpg'
rx_ukyo=re.compile(r"(['\"]drstone\|ukyo saionji['\"]\s*:\s*['\"])(https?://[^'\"]+)(['\"])",re.I)
m=rx_ukyo.search(s)
if not m:
    raise SystemExit('Ukyo verified image row not found')
s=s[:m.start(2)] + ukyo_new + s[m.end(2):]

p.write_text(s,encoding='utf-8')
print('qap filter:', marker in s)
print('ukyo replaced:', ukyo_new in s)
