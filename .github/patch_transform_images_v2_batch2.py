from pathlib import Path

p = Path('server.js')
s = p.read_text(encoding='utf-8')
marker = 'QAP_VERIFIED_TRANSFORM_IMAGES_V2'
start = s.find(marker)
if start < 0:
    raise SystemExit('verified transform array marker missing')
arr = s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [', start)
end = s.find('\n];', arr)
if arr < 0 or end < 0:
    raise SystemExit('verified transform array not found')

batch_marker = 'QAP_VERIFIED_TRANSFORM_BATCH2'
if batch_marker not in s[arr:end]:
    # Leading comma separates this batch from the final object already present
    # in the verified seed array.
    rows = r''',
    // QAP_VERIFIED_TRANSFORM_BATCH2 — visually/context-checked second pass.
    {
        needs:['ultra ego'],
        url:'https://cdn.alfabetajuega.com/alfabetajuega/2022/03/dragon-ball-super-vegeta-ultra-ego.jpg'
    },
    {
        needs:['gohan','beast'],
        url:'https://fr.dragon-ball-official.com/dragonball/jp/news/2023/01/SHF%20SON%20GOHAN%20%20BEAST%2002.jpg?_=1790947320'
    },
    {
        needs:['piccolo','orange'],
        url:'https://en.dragon-ball-official.com/dragonball/jp/news/2023/03/SHF%20ORANGE%20PICCOLO_01.jpg?_=1790957400'
    },
    {
        needs:['broly','full power'],
        url:'https://en.dragon-ball-official.com/dragonball/jp/news/2022/03/chara46_7.jpg?_=1790943900'
    },
    {
        needs:['gogeta','super saiyan blue'],
        url:'https://fr.dragon-ball-official.com/dragonball/jp/news/2025/12/1040_1040_gogeta2_o.jpg?_=1786515780'
    },
    {
        needs:['gogeta','super saiyan god super saiyan'],
        url:'https://fr.dragon-ball-official.com/dragonball/jp/news/2025/12/1040_1040_gogeta2_o.jpg?_=1786515780'
    },
    {
        needs:['black frieza'],
        url:'https://p7.itc.cn/images01/20230602/afea49694e24409dbca3a7924b978389.jpeg'
    },
    {
        needs:['black freezer'],
        url:'https://p7.itc.cn/images01/20230602/afea49694e24409dbca3a7924b978389.jpeg'
    }'''
    s = s[:end] + rows + s[end:]

p.write_text(s, encoding='utf-8')
print('batch2:', batch_marker in s)
print('Ultra Ego:', 'dragon-ball-super-vegeta-ultra-ego.jpg' in s)
print('Orange Piccolo:', 'SHF%20ORANGE%20PICCOLO_01.jpg' in s)
print('Black Frieza:', 'afea49694e24409dbca3a7924b978389.jpeg' in s)
