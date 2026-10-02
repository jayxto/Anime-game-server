from pathlib import Path
s=Path('server.js').read_text(encoding='utf-8')
needle='/api/character-catalog'
pos=0; out=[]; i=0
while True:
    p=s.find(needle,pos)
    if p<0: break
    i+=1
    out.append(f'=== OCCURRENCE {i} @ {p} ===\n')
    out.append(s[max(0,p-1800):min(len(s),p+6500)])
    out.append('\n\n')
    pos=p+len(needle)
Path('.github/catalog_route_context.txt').write_text(''.join(out),encoding='utf-8')
print('occurrences',i)
