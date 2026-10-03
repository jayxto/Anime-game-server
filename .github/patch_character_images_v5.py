from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

# Add provider/canonical aliases.
alias_marker='SIMPLE_CHARACTER_ALIASES_V5'
if alias_marker not in s:
    astart=s.find('const SIMPLE_ALIASES = new Map(Object.entries({')
    if astart<0: raise SystemExit('SIMPLE_ALIASES map not found')
    aend=s.find('\n}));',astart)
    if aend<0: raise SystemExit('SIMPLE_ALIASES end not found')
    rows=r'''
    ,
    // SIMPLE_CHARACTER_ALIASES_V5 — checked canonical/search names.
    'dgrayman|mana d campbell':'Mana Walker',
    'demonslayer|kasugai matsuemon':'Matsuemon Tennouji',
    'demonslayer|zenitsu s sparrow':'Chuntaro',
    'dragonball|c 14':'Android 14',
    'dragonball|c 15':'Android 15',
    'dragonball|c 8':'Android 8',
    'dragonball|docteur brief':'Dr. Brief',
    'dragonball|docteur hedo':'Dr. Hedo',
    'dragonball|docteur kochin':'Dr. Kochin',
    'dragonball|geene':'Giin',
    'dragonball|kaio de l est':'East Kai'
    // END SIMPLE_CHARACTER_ALIASES_V5'''
    s=s[:aend]+rows+s[aend:]

# Add visually reviewed image import sources.
image_marker='SIMPLE_VERIFIED_CHARACTER_IMAGES_V5'
if image_marker not in s:
    helper=s.find('function simpleVerifiedCharacterImage(u,name)')
    if helper<0: raise SystemExit('verified image helper not found')
    vstart=s.rfind('new Map(Object.entries({',0,helper)
    if vstart<0: raise SystemExit('verified image map start not found')
    vend=s.rfind('\n}));',vstart,helper)
    if vend<0: raise SystemExit('verified image map end not found')
    rows=r'''
    ,
    // SIMPLE_VERIFIED_CHARACTER_IMAGES_V5 — visually reviewed 2026-10-03.
    'dgrayman|mana d campbell':'https://static.wikia.nocookie.net/dgrayman/images/8/84/Mana_Walker_Clown_Hallow.png/revision/latest/scale-to-width-down/1200?cb=20191004082854',
    'demonslayer|zenitsu s sparrow':'https://neoapo.com/images/character/45725/8b882a75e080f929509d70555d465a4b.jpg',
    'conan|kazuha toyama':'https://i.pinimg.com/736x/c5/84/af/c584af6694b35d52546c9885162cd6c8.jpg',
    'conan|rei furuya':'https://vignette.wikia.nocookie.net/detektifconan/images/8/86/Rei_Furuya_Profile.jpg/revision/latest?cb=20180501041722&path-prefix=id',
    'dragonball|c 14':'https://thecodex.wiki/images/thumb/d/df/Dcbyuoj-fe6e02b1-3729-482d-9e3e-f379badde7ac.png/640px-Dcbyuoj-fe6e02b1-3729-482d-9e3e-f379badde7ac.png',
    'dragonball|c 15':'https://vignette.wikia.nocookie.net/vsbattles/images/0/01/Android_15_Legends.png/revision/latest?cb=20200227102541',
    'dragonball|c 8':'https://cdn.shopify.com/s/files/1/0252/1736/8154/files/Android_8_480x480.png?v=1607955461',
    'dragonball|docteur brief':'https://neoapo.com/images/character/46073/b088427e8b4f59c6fc52853b73332451.webp',
    'dragonball|docteur hedo':'https://neoapo.com/images/character/35960/27d98c3d8ddf79eb8e6012718daa9ca4.png',
    'dragonball|docteur kochin':'https://vignette.wikia.nocookie.net/dragonball/images/e/ea/Dr._Kochin_Dokkan.png/revision/latest?cb=20181208185112&path-prefix=es',
    'dragonball|geene':'https://i.pinimg.com/736x/dc/1b/62/dc1b6223ee06ee57f62f6425c9bf6500.jpg',
    'dragonball|kaio de l est':'https://i.pinimg.com/736x/2c/79/2b/2c792b55f5bcbabedd9dfb2da3598bdf.jpg'
    // END SIMPLE_VERIFIED_CHARACTER_IMAGES_V5'''
    s=s[:vend]+rows+s[vend:]

p.write_text(s,encoding='utf-8')
print('aliases v5:',alias_marker in s)
print('images v5:',image_marker in s)
