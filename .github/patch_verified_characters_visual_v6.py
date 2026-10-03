from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

replacements={
    # Nico Hirata — red hair over one eye, blazer/white top; Anime-Planet portrait visually checked.
    'https://i.pinimg.com/736x/16/95/43/169543da51737af1bdd422ce8c640284.jpg':
        'https://cdn.anime-planet.com/characters/primary/niko-hirata-1.webp?t=1660955578',
    # East Supreme Kai/Shin — lavender skin, white mohawk, Kai outfit; visually checked Pinterest candidate.
    'https://i.pinimg.com/736x/2c/79/2b/2c792b55f5bcbabedd9dfb2da3598bdf.jpg':
        'https://i.pinimg.com/736x/55/a7/ca/55a7ca3cce0a606d39510bec1e982ad3.jpg',
    # Bomb Girl = Reze — MAPPA promotional character art, normal Reze portrait rather than an opaque pin.
    'https://i.pinimg.com/736x/6e/67/1f/6e671f272ef9a1ebdaa2f15ffb6577ab.jpg':
        'https://static.zerochan.net/Reze.1024.4599201.webp',
    # Sealed Aizen — Muken restraints/chair, visually checked image; source accepts server-side fetching.
    'https://i.pinimg.com/736x/6e/12/d9/6e12d9a35cd1b461225b72aaf1e485e5.jpg':
        'https://i1.sndcdn.com/artworks-kzBn7kymKFnU1jEz-ho78oQ-t1080x1080.jpg',
    # Geene/Giin — Universe 12 God of Destruction; blue fish-like deity in purple Destroyer attire.
    'https://i.pinimg.com/736x/dc/1b/62/dc1b6223ee06ee57f62f6425c9bf6500.jpg':
        'https://i.pinimg.com/736x/28/35/f0/2835f07d35ae947b3f3204690346f32f.jpg',
}

changed=[]
for old,new in replacements.items():
    if new in s:
        continue
    if old not in s:
        raise SystemExit(f'old verified source not found: {old}')
    s=s.replace(old,new,1)
    changed.append((old,new))

marker='SIMPLE_VERIFIED_CHARACTER_VISUAL_BATCH6'
if marker not in s:
    anchor='const SIMPLE_VERIFIED_CHARACTER_IMAGES = new Map(Object.entries({'
    pos=s.find(anchor)
    if pos<0: raise SystemExit('verified character map anchor not found')
    s=s[:pos]+"// SIMPLE_VERIFIED_CHARACTER_VISUAL_BATCH6 — five visually rechecked ambiguous portraits.\n"+s[pos:]

p.write_text(s,encoding='utf-8')
print('changed',len(changed))
for _,new in changed: print(new)
print('marker',marker in s)
