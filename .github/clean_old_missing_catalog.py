from pathlib import Path
import json,collections
p=Path('.github/live_character_catalog_audit.json')
d=json.loads(p.read_text(encoding='utf-8'))
raw=d.get('missing') or []
# Old false positives from theme ingestion overwhelmingly had no universe.
real=[x for x in raw if str(x.get('u') or '').strip() and str(x.get('name') or '').strip()]
# Drop entries whose name is literally the universe's display anime title by using the
# fact that the old bad rows had no universe; remaining list is deliberately conservative.
by=collections.defaultdict(list)
for x in real: by[str(x.get('u'))].append(str(x.get('name')))
lines=[f'RAW_MISSING={len(raw)} NONEMPTY_UNIVERSE={len(real)} UNIVERSES={len(by)}','']
for u in sorted(by):
    lines.append(f'## {u} ({len(by[u])})')
    for n in sorted(set(by[u]),key=str.casefold): lines.append(n)
    lines.append('')
Path('.github/cleaned_old_missing_catalog.txt').write_text('\n'.join(lines),encoding='utf-8')
Path('.github/cleaned_old_missing_catalog.json').write_text(json.dumps(real,ensure_ascii=False,indent=2),encoding='utf-8')
print(lines[0])
