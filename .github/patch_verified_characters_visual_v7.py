from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

replacements={
    # Ko Yamori — anime screenshot portrait, black hair / track jacket.
    'https://i.pinimg.com/originals/91/ea/c6/91eac632a88586c250575bbcaebe243c.jpg':
        'https://cdn.rafled.com/anime-icons/images/b23f2b0117002d3e968e41fb65b936dd5221edf3db3279309f3664dad09726a6.jpg',
    # Minami Hokutozai — visually checked Dr. Stone portrait.
    'https://i.pinimg.com/originals/d4/52/9c/d4529c2309a21d55ea30eef7bb2176be.jpg':
        'https://i.pinimg.com/736x/bf/ef/b6/bfefb69ca7516bb5e42f7e3f80626f11.jpg',
    # Vincent Volaju — Cowboy Bebop movie anime frame, visually checked.
    'https://static.wixstatic.com/media/ed35c2_3fe6cc9f83c54970814ba7f682783bbe~mv2.jpg/v1/fit/w_500%2Ch_500%2Cq_90/file.jpg':
        'https://img2.wikia.nocookie.net/__cb20140401054309/cowboybebop/images/2/25/CL_Vincent.png',
    # Kazuha Toyama — clear Detective Conan anime portrait.
    'https://i.pinimg.com/736x/c5/84/af/c584af6694b35d52546c9885162cd6c8.jpg':
        'https://i.pinimg.com/736x/fd/f5/5f/fdf55f513dc40101f7c1e6605dd11f6f.jpg',
    # Isshin Kurosaki — official BLEACH TYBW character asset.
    'https://static.zerochan.net/Kurosaki.Isshin.1024.3983714.webp':
        'https://bleach-anime.com/assets/img/character/face_58.png',
    # Gyumao/Ox-King — official Dragon Ball weekly character showcase image.
    'https://thumbs.coleka.com/media/item/201807/03/dragon-ball-z-serie-1-gyumao-36-77.webp':
        'https://fr.dragon-ball-official.com/dragonball/jp/news/2023/11/chara136_2.jpg?_=1773153000',
}

changed=[]
for old,new in replacements.items():
    if new in s:
        continue
    if old not in s:
        raise SystemExit(f'old source not found: {old}')
    s=s.replace(old,new,1)
    changed.append(new)

marker='SIMPLE_VERIFIED_CHARACTER_VISUAL_BATCH7'
if marker not in s:
    anchor='const SIMPLE_VERIFIED_CHARACTER_IMAGES = new Map(Object.entries({'
    pos=s.find(anchor)
    if pos<0: raise SystemExit('verified character map anchor not found')
    s=s[:pos]+"// SIMPLE_VERIFIED_CHARACTER_VISUAL_BATCH7 — six visually rechecked portrait upgrades.\n"+s[pos:]

p.write_text(s,encoding='utf-8')
print('changed',len(changed))
for x in changed: print(x)
print('marker',marker in s)
