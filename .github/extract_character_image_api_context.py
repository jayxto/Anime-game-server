from pathlib import Path

s=Path('server.js').read_text(encoding='utf-8')
needles=[
    "app.post('/api/admin/character-image'",
    'async function simpleStoreImage',
    'async function getCachedCharacterImage',
    'function simpleImageRoute',
    "app.get('/api/character-catalog'",
    "app.get('/api/admin/character-catalog-persistent'",
]
out=[]
for needle in needles:
    pos=s.find(needle)
    out.append(f'\n=== {needle} @ {pos} ===\n')
    if pos < 0:
        out.append('NOT FOUND\n')
        continue
    a=max(0,pos-2500); b=min(len(s),pos+9000)
    out.append(s[a:b])
Path('.github/character_image_api_context.txt').write_text(''.join(out),encoding='utf-8')
print('context written')
