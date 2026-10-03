from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

replacements = {
    'https://i.pinimg.com/736x/64/c4/f6/64c4f690cd53f841d21568ad75225db4.jpg':
        'https://bleach-anime.com/assets/img/character/thumb_06.jpg',
    'https://i.pinimg.com/736x/18/20/db/1820dbe627174dd549dc87a8f8f8d9f2.jpg':
        'https://aonohako-anime.com/assets/img/top/chara/chara3_img.png',
    'https://i.pinimg.com/736x/12/ad/36/12ad365529c60630eaa70595f672431d.jpg':
        'https://aonohako-anime.com/assets/img/top/chara/chara4_img.png',
    'https://i.pinimg.com/736x/fd/f5/5f/fdf55f513dc40101f7c1e6605dd11f6f.jpg':
        'https://www.ytv.co.jp/conan/character/kazuha/images/main_sz5h9bmc7s033d819d9maj54rwnrj7.png',
    'https://i.pinimg.com/originals/64/77/af/6477af3868ca84fa25b5e36de4b77217.jpg':
        'https://danmachi.com/danmachi2/character/images/ais_kao.png',
}

changed=[]
for old,new in replacements.items():
    if old in s:
        s=s.replace(old,new)
        changed.append((old,new))
    elif new not in s:
        raise SystemExit(f'expected source not found: {old}')

marker='SIMPLE_VERIFIED_CHARACTER_OFFICIAL_BATCH9'
if marker not in s:
    anchor='const SIMPLE_VERIFIED_CHARACTER_IMAGES_V2 = {'
    pos=s.find(anchor)
    if pos<0: raise SystemExit('verified character source map not found')
    eol=s.find('\n',pos)
    s=s[:eol+1]+"    // SIMPLE_VERIFIED_CHARACTER_OFFICIAL_BATCH9 — reviewed official-source upgrades.\n"+s[eol+1:]

p.write_text(s,encoding='utf-8')
print('replaced',len(changed),'official character sources')
print('marker',marker in s)
