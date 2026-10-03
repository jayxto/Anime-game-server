from pathlib import Path
s=Path('server.js').read_text(encoding='utf-8')
out=[]
for needle in ["const THEME_CHAR_IMAGES", "simpleCatalogueSources", "if (theme.kind !== 'chars') continue;"]:
    start=0; n=0
    while True:
        p=s.find(needle,start)
        if p<0: break
        n+=1
        a=max(0,p-900); b=min(len(s),p+2800)
        out.append(f'=== {needle} #{n} @ {p} ===\n{s[a:b]}\n\n')
        start=p+len(needle)
Path('.github/catalog_loops_v5.txt').write_text(''.join(out),encoding='utf-8')
print('written',len(out),'contexts')
