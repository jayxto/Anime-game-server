from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find("app.get('/api/character-catalog'")
if start<0: raise SystemExit('character catalog route not found')
end=s.find("\napp.",start+30)
if end<0: end=min(len(s),start+80000)
block=s[start:end]
marker='CHARACTER_CATALOG_ROUTE_CANONICAL_V3'

if marker not in block:
    needle="""            if (arcAnime) anime = arcAnime;
            const group = u || normalizeImageKey(anime) || 'autre';
"""
    repl="""            // CHARACTER_CATALOG_ROUTE_CANONICAL_V3 — canonicalize after anime resolution too.
            if (u === 'fate') u = 'fatestay';
            if (u === 'soul') u = 'souleater';
            if (arcAnime) anime = arcAnime;
            const compactName = normalizeImageKey(name).replace(/[^a-z0-9]+/g, '');
            if (u === 'fatestay' && ['fateroute','heavensfeel','unlimitedbladeworks'].includes(compactName)) return;
            if ((source === 'tierlist-themes' || source === 'qap-themes') && normalizeImageKey(name) === normalizeImageKey(anime)) return;
            const group = u || normalizeImageKey(anime) || 'autre';
"""
    if needle not in block:
        raise SystemExit('catalog route post-resolution anchor not found')
    block=block.replace(needle,repl,1)
    s=s[:start]+block+s[end:]

p.write_text(s,encoding='utf-8')
print('route canonical v3:',marker in s)
print('fake fate filters:',all(x in s for x in ['fateroute','heavensfeel','unlimitedbladeworks']))
