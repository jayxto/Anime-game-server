from pathlib import Path
import re

p=Path('server.js')
s=p.read_text(encoding='utf-8')

updates = {
    'bleach|genryusai yamamoto':'https://bleach-anime.com/assets/img/character/thumb_06.jpg',
    'bluebox|hina chono':'https://aonohako-anime.com/assets/img/top/chara/chara3_img.png',
    'bluebox|kyo kasahara':'https://aonohako-anime.com/assets/img/top/chara/chara4_img.png',
    'conan|kazuha toyama':'https://www.ytv.co.jp/conan/character/kazuha/images/main_sz5h9bmc7s033d819d9maj54rwnrj7.png',
    'danmachi|aiz wallenstein':'https://danmachi.com/danmachi2/character/images/ais_kao.png',
}

for key,url in updates.items():
    # Restrict to JS object entries shaped like 'universe|name':'url'.
    rx=re.compile(r"([\'\"]"+re.escape(key)+r"[\'\"]\s*:\s*)[\'\"][^\'\"]*[\'\"]")
    s2,n=rx.subn(lambda m: m.group(1)+repr(url),s)
    if n < 1:
        raise SystemExit(f'verified character key not found: {key}')
    s=s2

marker='SIMPLE_VERIFIED_CHARACTER_OFFICIAL_BATCH9_V2'
if marker not in s:
    anchor='const SIMPLE_VERIFIED_CHARACTER_IMAGES_V2 = {'
    pos=s.find(anchor)
    if pos<0: raise SystemExit('verified character source map not found')
    eol=s.find('\n',pos)
    s=s[:eol+1]+"    // SIMPLE_VERIFIED_CHARACTER_OFFICIAL_BATCH9_V2 — official portrait URLs visually checked.\n"+s[eol+1:]

p.write_text(s,encoding='utf-8')
print('official keys upgraded:',len(updates))
