from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

# Add conservative name aliases used by the automatic providers.
alias_marker='SIMPLE_ALIAS_BATCH_IMAGE_V2'
a0=s.find('const SIMPLE_ALIASES = new Map(Object.entries({')
a1=s.find('\n}));',a0)
if a0<0 or a1<0: raise SystemExit('SIMPLE_ALIASES map not found')
if alias_marker not in s[a0:a1]:
    body=s[a0:a1]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // SIMPLE_ALIAS_BATCH_IMAGE_V2 — conservative provider/display-name aliases.
    'another|yuya mochizuki':'Yuuya Mochizuki',
    'bleach|genryusai yamamoto':'Shigekuni Genryusai Yamamoto',
    'bleach|ichigo papa':'Isshin Kurosaki',
    'callnight|nico hirata':'Niko Hirata',
    'chainsaw|bomb girl':'Reze',
    'chainsaw|demon pieuvre':'Octopus Devil',
    'chainsaw|demon poulet':'Bucky',
    'chainsaw|demon serpent':'Snake Devil',
    'chainsaw|demon typhon':'Typhoon Devil',
    'digimon|koshiro izumi':'Koushiro Izumi',
    'dragonball|c 14':'Android 14',
    'dragonball|c 15':'Android 15',
    'dragonball|c 8':'Android 8',
    'dragonball|docteur brief':'Dr. Brief',
    'dragonball|docteur hedo':'Dr. Hedo',
    'dragonball|docteur kochin':'Dr. Kochin',
    'dragonball|gyumao':'Ox-King' '''
    s=s[:a1]+rows+s[a1:]

# Add visually-reviewed sources to the persistent import seed map.
img_marker='SIMPLE_VERIFIED_CHARACTER_IMAGES_V2'
i0=s.find('const SIMPLE_VERIFIED_CHARACTER_IMAGES = new Map(Object.entries({')
i1=s.find('\n}));',i0)
if i0<0 or i1<0: raise SystemExit('SIMPLE_VERIFIED_CHARACTER_IMAGES map not found')
if img_marker not in s[i0:i1]:
    body=s[i0:i1]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // SIMPLE_VERIFIED_CHARACTER_IMAGES_V2 — visually reviewed batch 2.
    'bleach|genryusai yamamoto':'https://i.pinimg.com/736x/64/c4/f6/64c4f690cd53f841d21568ad75225db4.jpg',
    'bleach|ichigo papa':'https://static.zerochan.net/Kurosaki.Isshin.1024.3983714.webp',
    'bleach|sosuke aizen scelle':'https://i.pinimg.com/736x/6e/12/d9/6e12d9a35cd1b461225b72aaf1e485e5.jpg',
    'bluebox|hina chono':'https://i.pinimg.com/736x/18/20/db/1820dbe627174dd549dc87a8f8f8d9f2.jpg',
    'bluebox|kyo kasahara':'https://i.pinimg.com/736x/12/ad/36/12ad365529c60630eaa70595f672431d.jpg',
    'bocchi|ryo yamada':'https://prcdn.freetls.fastly.net/release_image/16356/3474/16356-3474-b03735e642b25479cce130514dcaf5f2-1587x2245.jpg?auto=webp&fit=bounds&format=jpeg&height=1350&quality=85%2C65&width=1950',
    'callnight|ko yamori':'https://i.pinimg.com/originals/91/ea/c6/91eac632a88586c250575bbcaebe243c.jpg',
    'callnight|nico hirata':'https://i.pinimg.com/736x/16/95/43/169543da51737af1bdd422ce8c640284.jpg' '''
    s=s[:i1]+rows+s[i1:]

p.write_text(s,encoding='utf-8')
print('aliases v2:',alias_marker in s)
print('images v2:',img_marker in s)
print('Isshin alias:',"'bleach|ichigo papa':'Isshin Kurosaki'" in s)
print('Niko alias:',"'callnight|nico hirata':'Niko Hirata'" in s)
