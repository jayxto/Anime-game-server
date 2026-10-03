from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

# 1) Exclude exact non-character labels accidentally pulled from game/theme pools.
marker='SIMPLE_NON_CHARACTER_EXACT_V1'
if marker not in s:
    anchor='async function simpleCatalogue() {'
    pos=s.find(anchor)
    if pos<0: raise SystemExit('simpleCatalogue anchor not found')
    block=r'''// SIMPLE_NON_CHARACTER_EXACT_V1 — exact labels that are arcs, groups, places or concepts,
// not character portraits. They stay available to their game/theme data; they are only excluded
// from the persistent CHARACTER image migration.
const SIMPLE_NON_CHARACTER_EXACT_V1 = new Set([
    'eightysix|federacy',
    'assclass|final exams',
    'assclass|graduation',
    'beastars|interspecies relations',
    'beastars|murder incident solution',
    'clover|charlotte s squad',
    'clover|fuegoleon s squad',
    'codegeass|r2 final rebellion',
    'conan|black organization',
    'conan|clash of red and black',
    'conan|scarlet return',
    'drstone|new america city',
    'drstone|stone wars',
    'drstone|stone world',
    'drstone|treasure island'
]);

'''
    s=s[:pos]+block+s[pos:]

# Wire exclusion into simpleCatalogue.add after canonical universe normalization.
needle="""        if (u === 'fate') u = 'fatestay';
        if (u === 'soul') u = 'souleater';
        if (!u || !name) return;"""
replacement="""        if (u === 'fate') u = 'fatestay';
        if (u === 'soul') u = 'souleater';
        if (!u || !name) return;
        if (SIMPLE_NON_CHARACTER_EXACT_V1.has(`${simpleImageCompact(u)}|${simpleImageNorm(name)}`)) return;"""
if 'SIMPLE_NON_CHARACTER_EXACT_V1.has(' not in s:
    if needle not in s: raise SystemExit('simpleCatalogue canonical universe block not found')
    s=s.replace(needle,replacement,1)

# 2) Add safe spelling/canonical aliases so provider searches use known character names.
alias_marker='SIMPLE_CHARACTER_ALIASES_V4'
if alias_marker not in s:
    astart=s.find('const SIMPLE_ALIASES = new Map(Object.entries({')
    if astart<0: raise SystemExit('SIMPLE_ALIASES map not found')
    aend=s.find('\n}));',astart)
    if aend<0: raise SystemExit('SIMPLE_ALIASES map end not found')
    aliases=r''',
    // SIMPLE_CHARACTER_ALIASES_V4 — checked canonical/search names.
    'bocchi|futari gotoh':'Futari Gotou',
    'demonslayer|zenitsu s sparrow':'Chuntaro',
    'conan|kaito kid':'Kaito Kuroba',
    'conan|kogoro mouri':'Kogoro Mori',
    'dragonball|docteur arinsu':'Dr. Arinsu',
    'dragonball|docteur mu':'Dr. Myuu',
    'dragonball|docteur willow':'Dr. Wheelo',
    'dragonball|general rild':'General Rilldo'
    // END SIMPLE_CHARACTER_ALIASES_V4'''
    s=s[:aend]+aliases+s[aend:]

# 3) Add visually-reviewed image import sources. These are copied into PostgreSQL bytes by
# simpleMigrationPass; the remote URL is not the final rendering dependency.
image_marker='SIMPLE_VERIFIED_CHARACTER_IMAGES_V4'
if image_marker not in s:
    vstart=s.find('const SIMPLE_VERIFIED_CHARACTER_IMAGES')
    if vstart<0:
        # variable may be declared as Map without nearby const search index support; locate helper and walk back.
        helper=s.find('function simpleVerifiedCharacterImage(u,name)')
        if helper<0: raise SystemExit('verified character image helper not found')
        vstart=max(0,s.rfind('new Map(Object.entries({',0,helper))
    helper=s.find('function simpleVerifiedCharacterImage(u,name)',vstart)
    if helper<0: raise SystemExit('verified helper end anchor not found')
    vend=s.rfind('\n}));',vstart,helper)
    if vend<0: raise SystemExit('verified image map end not found')
    rows=r''',
    // SIMPLE_VERIFIED_CHARACTER_IMAGES_V4 — visually reviewed 2026-10-03.
    'bocchi|futari gotoh':'https://cdn.myanimelist.net/images/characters/10/493791.webp?s=bdd6daf4624618470817611b5e4c8577',
    'conan|kaito kid':'https://i.pinimg.com/736x/99/aa/40/99aa407765073c87bb06544ffe81ecae.jpg',
    'conan|kogoro mouri':'https://f.media-amazon.com/images/S/pv-target-images/121d81556c59ce7b502db217ae96f706316fb258fb6ab34d06300c5ad8451dc9._CR350%2C0%2C1080%2C1080_.jpg',
    'drstone|minami hokutozai':'https://i.pinimg.com/originals/d4/52/9c/d4529c2309a21d55ea30eef7bb2176be.jpg',
    'drstone|senku ishigami':'https://a.storyblok.com/f/178900/712x1362/b844774350/ds1_senku.png/m/filters%3Aquality%2895%29format%28webp%29',
    'drstone|taiju oki':'https://static.wikia.nocookie.net/dr-stone/images/6/69/Taiju_Oki_%28Anime%29.png/revision/latest?cb=20190705185117',
    'drstone|ukyo saionji':'https://anibase.net/files/d3a35b167052ef0e059174f5717c2519',
    'drstone|yo uei':'https://i.pinimg.com/736x/f2/6f/b3/f26fb3d927a271c05a9bb770f4939ea8.jpg',
    'dragonball|docteur arinsu':'https://static.zerochan.net/Dr..Arinsu.1024.4317613.webp',
    'dragonball|docteur mu':'https://vignette.wikia.nocookie.net/dragon-ball-gt-and-af/images/9/92/Myuu.png/revision/latest?cb=20200114102110',
    'dragonball|docteur willow':'https://www.looper.com/img/gallery/every-dragon-ball-movie-ranked-according-to-imdb/dragon-ball-z-the-worlds-strongest-1663016461.jpg',
    'dragonball|general rild':'https://m.media-amazon.com/images/M/MV5BYTE5ZjBmYjEtZDE1Yy00MTJmLTkxOTYtNTY2ZTgzNTA3NDZjXkEyXkFqcGc%40._V1_.jpg'
    // END SIMPLE_VERIFIED_CHARACTER_IMAGES_V4'''
    s=s[:vend]+rows+s[vend:]

p.write_text(s,encoding='utf-8')
print('non-character filter:', marker in s and 'SIMPLE_NON_CHARACTER_EXACT_V1.has' in s)
print('aliases v4:', alias_marker in s)
print('images v4:', image_marker in s)
