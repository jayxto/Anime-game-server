from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

replacements={
    # Ryo Yamada — clear Bocchi the Rock anime portrait, visually checked.
    'https://prcdn.freetls.fastly.net/release_image/16356/3474/16356-3474-b03735e642b25479cce130514dcaf5f2-1587x2245.jpg?auto=webp&fit=bounds&format=jpeg&height=1350&quality=85%2C65&width=1950':
        'https://cdn.rafled.com/anime-icons/images/7z9SrV28Eit8hSVVG4isKIgt0OvUE8fT.jpg',
    # Android 14 / C-14 — explicit character portrait instead of an opaque random filename.
    'https://thecodex.wiki/images/thumb/d/df/Dcbyuoj-fe6e02b1-3729-482d-9e3e-f379badde7ac.png/640px-Dcbyuoj-fe6e02b1-3729-482d-9e3e-f379badde7ac.png':
        'https://neoapo.com/images/character/41877/7659046d79639f9f430922abd7e996bd.webp',
    # Ryoma Terasaka — clear Assassination Classroom portrait, visually checked.
    'https://pbs.twimg.com/media/B2zAY0cCEAAexwm.jpg':
        'https://cdn.gamerch.com/contents/wiki/4008/entry/idyh0sw9.jpg',
    # Kaito Kid — clear Detective Conan / Magic Kaito portrait, visually checked.
    'https://i.pinimg.com/736x/99/aa/40/99aa407765073c87bb06544ffe81ecae.jpg':
        'https://imgs.laipeitu.com/upload/2022/2022031311/58976.jpg',
}

changed=[]
for old,new in replacements.items():
    if new in s:
        continue
    if old not in s:
        raise SystemExit(f'old source not found: {old}')
    s=s.replace(old,new,1)
    changed.append(new)

marker='SIMPLE_VERIFIED_CHARACTER_VISUAL_BATCH8'
if marker not in s:
    anchor='const SIMPLE_VERIFIED_CHARACTER_IMAGES = new Map(Object.entries({'
    pos=s.find(anchor)
    if pos<0: raise SystemExit('verified character map anchor not found')
    s=s[:pos]+"// SIMPLE_VERIFIED_CHARACTER_VISUAL_BATCH8 — four visually rechecked ambiguous portraits.\n"+s[pos:]

p.write_text(s,encoding='utf-8')
print('changed',len(changed))
for x in changed: print(x)
print('marker',marker in s)
