from pathlib import Path
s=Path('server.js').read_text(encoding='utf-8')
a=s.find("app.get('/api/character-catalog'")
if a<0: raise SystemExit('route not found')
# Find the next express route declaration after this one.
positions=[]
for token in ["\napp.get('", "\napp.post('", "\napp.put('", "\napp.delete('"]:
    p=s.find(token,a+40)
    if p>=0: positions.append(p)
b=min(positions) if positions else min(len(s),a+120000)
route=s[a:b]
lines=route.splitlines()
out=[f'ROUTE_START={a} ROUTE_END={b} CHARS={len(route)} LINES={len(lines)}']
for i,line in enumerate(lines):
    if any(k in line for k in ['add(', 'theme.kind', 'parsed.themes', 'qap-themes', 'tierlist-themes', 'simpleCatalogue', 'ARC_', 'DLE_', 'RG_', 'cardPool', 'QAP_', 'anime-themes', 'transformation']):
        lo=max(0,i-2); hi=min(len(lines),i+4)
        out.append('\n--- line %d ---\n%s' % (i+1,'\n'.join(lines[lo:hi])))
Path('.github/character_route_sources_v10.txt').write_text('\n'.join(out),encoding='utf-8')
print(out[0], 'hits', len(out)-1)
