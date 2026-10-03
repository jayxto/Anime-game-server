from pathlib import Path

s = Path('server.js').read_text(encoding='utf-8')
needles = [
    "for (const theme of themes)",
    "theme.kind !== 'chars'",
    'simpleCatalogueSources',
    "app.get('/api/character-catalog'",
]
out=[]
seen=[]
for needle in needles:
    start=0
    while True:
        p=s.find(needle,start)
        if p<0: break
        a=max(0,p-1200); b=min(len(s),p+4200)
        if not any(abs(p-x)<500 for x in seen):
            seen.append(p)
            out.append(f'\n=== {needle} @ {p} ===\n')
            out.append(s[a:b])
        start=p+len(needle)
Path('.github/catalog_qap_context_v4.txt').write_text(''.join(out),encoding='utf-8')
print('contexts',len(seen))
