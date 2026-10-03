from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

# Correct malformed/canonical names used by provider searches.
alias_marker='SIMPLE_CHARACTER_ALIASES_V6'
if alias_marker not in s:
    astart=s.find('const SIMPLE_ALIASES = new Map(Object.entries({')
    if astart<0: raise SystemExit('SIMPLE_ALIASES map not found')
    aend=s.find('\n}));',astart)
    if aend<0: raise SystemExit('SIMPLE_ALIASES end not found')
    rows=r'''
    ,
    // SIMPLE_CHARACTER_ALIASES_V6 — verified name corrections.
    'cote|kaya ishikura':'Kayoko Ishikura',
    'digimon|koshiro izumi':'Koushiro Izumi'
    // END SIMPLE_CHARACTER_ALIASES_V6'''
    s=s[:aend]+rows+s[aend:]

# Tetsuya Machida is a corrupted composite of two distinct COTE characters:
# Tetsuya Hamaguchi and Koji Machida. Do not assign one of their portraits to it.
if "'cote|tetsuya machida'" not in s:
    set_start=s.find('const SIMPLE_NON_CHARACTER_EXACT_V1 = new Set([')
    set_end=s.find('\n]);',set_start)
    if set_start<0 or set_end<0: raise SystemExit('non-character set not found')
    body=s[set_start:set_end]
    prefix='' if body.rstrip().endswith(',') else ','
    s=s[:set_end]+prefix+"\n    'cote|tetsuya machida' // malformed composite, not a canonical character"+s[set_end:]

# Add reviewed image sources. They are imported into PostgreSQL bytes by the migration.
image_marker='SIMPLE_VERIFIED_CHARACTER_IMAGES_V6'
if image_marker not in s:
    helper=s.find('function simpleVerifiedCharacterImage(u,name)')
    if helper<0: raise SystemExit('verified image helper not found')
    vstart=s.rfind('new Map(Object.entries({',0,helper)
    if vstart<0: raise SystemExit('verified image map start not found')
    vend=s.rfind('\n}));',vstart,helper)
    if vend<0: raise SystemExit('verified image map end not found')
    rows=r'''
    ,
    // SIMPLE_VERIFIED_CHARACTER_IMAGES_V6 — visually reviewed 2026-10-03.
    'cote|reon kondo':'https://cdn.anime-planet.com/characters/primary/reo-kondou-1.webp?t=1661325903',
    'digimon|koshiro izumi':'https://i.pinimg.com/originals/bc/4c/6a/bc4c6a1670248f88e6831b5da741f16f.png',
    'dragonball|ea':'https://www.toei-anim.co.jp/tv/dragon_s/assets/img/chara/chapter4/no03/u03_ea.png',
    'dragonball|gyumao':'https://thumbs.coleka.com/media/item/201807/03/dragon-ball-z-serie-1-gyumao-36-77.webp'
    // END SIMPLE_VERIFIED_CHARACTER_IMAGES_V6'''
    s=s[:vend]+rows+s[vend:]

p.write_text(s,encoding='utf-8')
print('aliases v6:',alias_marker in s)
print('malformed composite excluded:',"'cote|tetsuya machida'" in s)
print('images v6:',image_marker in s)
