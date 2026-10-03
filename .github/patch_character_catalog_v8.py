from pathlib import Path
import re

p=Path('server.js')
s=p.read_text(encoding='utf-8')

# 1) QAP contains non-character themes that were polluting /api/character-catalog.
marker='CHARACTER_CATALOG_QAP_FILTER_V8'
if marker not in s:
    needle="""                    if (theme.kind !== 'chars') continue;
                    for (const item of (theme.items || [])) {"""
    replacement="""                    if (theme.kind !== 'chars') continue;
                    // CHARACTER_CATALOG_QAP_FILTER_V8 — these QAP themes contain forms/arcs/anime titles,
                    // not normal character portraits. They have their own media/image pipelines.
                    if (file === 'qap-themes.json' && ['transformation','arc','isekai','shonen','anime'].includes(String(theme.id || ''))) continue;
                    for (const item of (theme.items || [])) {"""
    if needle not in s:
        raise SystemExit('QAP character-catalog loop anchor not found')
    s=s.replace(needle,replacement,1)

# 2) Replace the dead 403 Ukyo source with a visually checked anime frame.
ukyo_new='https://times-abema.ismcdn.jp/mwimgs/3/3/724w/img_33316d797bfecc3a90883fc92118ffc473569.jpg'
rx=re.compile(r"(['\"]drstone\|ukyo saionji['\"]\s*:\s*['\"])(https?://[^'\"]+)(['\"])",re.I)
m=rx.search(s)
if not m:
    raise SystemExit('Ukyo verified image row not found')
s=s[:m.start(2)] + ukyo_new + s[m.end(2):]

p.write_text(s,encoding='utf-8')
print('qap filter:', marker in s)
print('ukyo replaced:', ukyo_new in s)
