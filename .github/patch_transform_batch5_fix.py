from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end=s.find('\n];',start)
if start<0 or end<0:
    raise SystemExit('verified source array not found')

marker='QAP_VERIFIED_TRANSFORM_BATCH5_FIX_12'
if marker not in s[start:end]:
    body=s[start:end]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // QAP_VERIFIED_TRANSFORM_BATCH5_FIX_12 — the 12-row batch previously skipped because
    // the old marker collided with the separate Rage Shield batch.
    { needs:['ichigo','vasto lorde'], url:'https://fwmedia.fandomwire.com/wp-content/uploads/2025/03/25081716/Ichigo-bleach-1.png' },
    { needs:['ichigo','final getsuga'], url:'https://m.media-amazon.com/images/M/MV5BNTQ0YjRjMGMtMTA3Mi00ODcwLWE0ODktMGRhYzE5ODYzNzk2XkEyXkFqcGc%40._V1_.jpg' },
    { needs:['gon','adult gon'], url:'https://i.pinimg.com/736x/29/23/ec/2923eccaa3e41c8dde80ff2736ad9d71.jpg' },
    { needs:['eren','founding titan'], url:'https://p2.trrsf.com/image/fget/cf/1200/1200/middle/images.terra.com/2023/01/31/attack-on-titan-final-season_capa-1hbd8gzh1aixt.jpg' },
    { needs:['eren','attack titan'], url:'https://abrakadabra.fun/uploads/posts/2022-03/1647619410_13-abrakadabra-fun-p-eren-titan-skrinshoti-47.jpg' },
    { needs:['nezuko','demon nezuko'], url:'https://i.pinimg.com/736x/9e/66/0a/9e660a07bbb7ebea76f3dda78d511845.jpg' },
    { needs:['natsu','dragon force'], url:'https://static.tvtropes.org/pmwiki/pub/images/end_stands_before_gray.jpg' },
    { needs:['guts','berserker armor'], url:'https://get.wallhere.com/photo/Berserk-anime-manga-Guts-black-armor-1386381.jpg' },
    { needs:['izuku','dark deku'], url:'https://static.animecorner.me/2023/03/Dark-Deku.png' },
    { needs:['yuno','spirit dive'], url:'https://statico.soapcentral.com/editor/2025/05/f3fe3-17486149035498.jpg' },
    { needs:['griffith','femto'], url:'https://staticg.sportskeeda.com/editor/2025/08/c959b-17555897106078-1920.jpg' },
    { needs:['escanor','the one ultimate'], url:'https://img2.animatetimes.com/2021/05/60a22124c3e50_4f94bcec41df851cc7f351e37d62db66.jpg' }'''
    s=s[:end]+rows+s[end:]

p.write_text(s,encoding='utf-8')
print('marker:', marker in s)
for token in ['vasto lorde','adult gon','founding titan','dragon force','dark deku','spirit dive','femto','the one ultimate']:
    print(token, token in s.lower())
