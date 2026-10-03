from pathlib import Path
import re

p=Path('server.js')
s=p.read_text(encoding='utf-8')

# 1) QAP contains non-character themes that were polluting /api/character-catalog.
marker='CHARACTER_CATALOG_QAP_FILTER_V8'
if marker not in s:
    route_marker=s.find('// PATCH CHARACTER ADMIN V1')
    if route_marker < 0:
        raise SystemExit('real character admin route marker not found')
    loop=s.find("for (const file of ['tierlist-themes.json', 'qap-themes.json'])", route_marker)
    if loop < 0:
        raise SystemExit('QAP catalogue file loop not found after real route marker')
    anchor="if (theme.kind !== 'chars') continue;"
    pos=s.find(anchor, loop)
    if pos < 0 or pos > loop+12000:
        raise SystemExit('theme chars filter not found in QAP catalogue loop')
    insert_at=pos+len(anchor)
    insert="""
                    // CHARACTER_CATALOG_QAP_FILTER_V8 — forms/arcs/anime titles are not normal character portraits.
                    if (file === 'qap-themes.json' && ['transformation','arc','isekai','shonen','anime'].includes(String(theme.id || ''))) continue;"""
    s=s[:insert_at]+insert+s[insert_at:]

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
