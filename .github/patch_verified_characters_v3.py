from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

# Additional conservative aliases.
alias_marker='SIMPLE_ALIAS_BATCH_IMAGE_V3'
a0=s.find('const SIMPLE_ALIASES = new Map(Object.entries({')
a1=s.find('\n}));',a0)
if a0<0 or a1<0: raise SystemExit('SIMPLE_ALIASES map not found')
if alias_marker not in s[a0:a1]:
    body=s[a0:a1]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // SIMPLE_ALIAS_BATCH_IMAGE_V3
    'clannad|tomoya debut':'Tomoya Okazaki',
    'danmachi|aiz wallenstein':'Ais Wallenstein',
    'dgrayman|the millennium earl':'Millennium Earl'
'''
    s=s[:a1]+rows+s[a1:]

img_marker='SIMPLE_VERIFIED_CHARACTER_IMAGES_V3'
i0=s.find('const SIMPLE_VERIFIED_CHARACTER_IMAGES = new Map(Object.entries({')
i1=s.find('\n}));',i0)
if i0<0 or i1<0: raise SystemExit('SIMPLE_VERIFIED_CHARACTER_IMAGES map not found')
if img_marker not in s[i0:i1]:
    body=s[i0:i1]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // SIMPLE_VERIFIED_CHARACTER_IMAGES_V3 — visually reviewed batch 3.
    'chainsaw|bomb girl':'https://i.pinimg.com/736x/6e/67/1f/6e671f272ef9a1ebdaa2f15ffb6577ab.jpg',
    'chainsaw|demon poulet':'https://i0.wp.com/www.comicbookrevolution.com/wp-content/uploads/2022/07/Chainsaw-Man-Chapter-98-1.png?ssl=1',
    'chainsaw|demon typhon':'https://static.wikia.nocookie.net/chainsaw-man/images/8/89/Typhoon_Devil_Reze_Arc_anime_design.png/revision/latest?cb=20250704001946',
    'chainsaw|taiyo hayakawa':'https://manga-imperial.fr/cdn/shop/articles/taiyo_hayakawa_1920x.jpg?v=1682332072',
    'clannad|tomoya debut':'https://cdn.rafled.com/anime-icons/images/9wPrequXz045.jpg',
    'cowboybebop|vincent volaju':'https://static.wixstatic.com/media/ed35c2_3fe6cc9f83c54970814ba7f682783bbe~mv2.jpg/v1/fit/w_500%2Ch_500%2Cq_90/file.jpg',
    'dgrayman|the millennium earl':'https://dgrayman-anime.com/images/chara4.png',
    'danmachi|aiz wallenstein':'https://i.pinimg.com/originals/64/77/af/6477af3868ca84fa25b5e36de4b77217.jpg'
'''
    s=s[:i1]+rows+s[i1:]

p.write_text(s,encoding='utf-8')
print('alias v3:',alias_marker in s)
print('images v3:',img_marker in s)
