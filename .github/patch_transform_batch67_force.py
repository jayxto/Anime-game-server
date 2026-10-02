from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end=s.find('\n];',start)
if start<0 or end<0:
    raise SystemExit('verified transform array not found')

rows = [
("Colossal_Titan_%28Anime%29_character_image_%28Armin_Arlelt%29", "    { needs:['armin','colossal titan'], url:'https://static.wikia.nocookie.net/shingekinokyojin/images/e/ed/Colossal_Titan_%28Anime%29_character_image_%28Armin_Arlelt%29.png/revision/latest?cb=20220222211301' }"),
("1771602774_8582.webp", "    { needs:['mahoraga','adaptation'], url:'https://myanimethoughts.com/assets/images/blogs/1771602774_8582.webp' }"),
("81937c8b0b84adf5bf7d08f376dfeb2f.png", "    { needs:['natsu','lightning flame dragon mode'], url:'https://i.pinimg.com/originals/81/93/7c/81937c8b0b84adf5bf7d08f376dfeb2f.png' }"),
("static.animecorner.me/2022/12/mob-5.jpg", "    { needs:['shigeo','mob'], forbids:['100%'], url:'https://static.animecorner.me/2022/12/mob-5.jpg' }"),
("8bcb-iaqfzyv7625624.jpg", "    { needs:['kaneki','black reaper'], url:'https://n.sinaimg.cn/sinacn10114/481/w847h434/20190801/8bcb-iaqfzyv7625624.jpg' }"),
("Tensura-Rimuru-Demon-Lord.jpg", "    { needs:['rimuru','demon lord'], url:'https://cdn.oneesports.id/cdn-data/sites/2/2024/03/Tensura-Rimuru-Demon-Lord.jpg' }"),
("ep3372_img05_911a6256d663.jpg", "    { needs:['sung jinwoo','shadow monarch'], url:'https://nxsnjqfqtwiaoedulnpr.supabase.co/storage/v1/object/public/image/articles/ep3372_img05_911a6256d663.jpg' }"),
("Screenshot-2025-11-22-235910_692203770be00.png", "    { needs:['izuku','final war'], url:'https://im.indiatimes.in/content/2025/Nov/Screenshot-2025-11-22-235910_692203770be00.png' }"),
("dandadan-okarun-turbo-granny-form-s2", "    { needs:['ken takakura','turbo granny'], url:'https://img.uhdpaper.com/wallpaper/dandadan-okarun-turbo-granny-form-s2-833%405%40h-pc-4k.jpg' }"),
("0f53e-17515803921839-1920.jpg", "    { needs:['jiji','evil eye'], url:'https://staticg.sportskeeda.com/editor/2025/07/0f53e-17515803921839-1920.jpg' }"),
("img_de1baf8d6a25d6a92b29a82a2cca09871300637.jpg", "    { needs:['momo ayase','psychic awakening'], url:'https://times.abema.tv/mwimgs/d/e/-/img_de1baf8d6a25d6a92b29a82a2cca09871300637.jpg' }"),
("Frieren-reveals-her-true-power.jpg", "    { needs:['frieren','mana unleashed'], url:'https://otakuauthor.com/wp-content/uploads/Frieren-Beyond-Journeys-End-Episode-10-Frieren-reveals-her-true-power.jpg' }"),
("20250222200748.jpg", "    { needs:['aura','scales of obedience'], url:'https://cdn-ak.f.st-hatena.com/images/fotolife/s/shyuya86/20250222/20250222200748.jpg' }"),
("vinland-saga.1698260862.2708.jpg", "    { needs:['thorfinn','warrior era'], url:'https://alfabetajuega.com/hero/2023/10/vinland-saga.1698260862.2708.jpg?aspect_ratio=16%3A9&format=nowebp&width=768' }"),
("420-11_s1_p19/thumb001.png", "    { needs:['rimuru','dragon form'], url:'https://image.p-c2-x.abema-tv.com/image/programs/420-11_s1_p19/thumb001.png?background=000000&fit=fill&height=432&quality=75&version=1777272484&width=768' }"),
("Ex9rFYjU8AIClSJ.jpg", "    { needs:['milim','demon lord'], url:'https://pbs.twimg.com/media/Ex9rFYjU8AIClSJ.jpg' }"),
("Diablo.%28Tensei.Shitara.Slime.Datta.Ken%29.full.3079251.jpg", "    { needs:['diablo','demon lord'], url:'https://static.zerochan.net/Diablo.%28Tensei.Shitara.Slime.Datta.Ken%29.full.3079251.jpg' }"),
("499325.jpg?zoom=spacing", "    { needs:['anos','demon king'], url:'https://s.animeanime.jp/imgs/p/64XVvff3mD9cFhi_PU1_DqGg_6ytrq_oqaqr/499325.jpg?zoom=spacing' }"),
("Ordinal.Strata.full.2342777.jpg", "    { needs:['emilia','spirit form'], url:'https://static.zerochan.net/Ordinal.Strata.full.2342777.jpg' }"),
]

pending=[row for key,row in rows if key not in s[start:end]]
if pending:
    body=s[start:end]
    prefix='' if body.rstrip().endswith(',') else ','
    payload=prefix+'\n    // QAP_VERIFIED_TRANSFORM_BATCH67_FORCE — verified rows forced by unique source URL.\n'+',\n'.join(pending)
    s=s[:end]+payload+s[end:]
    p.write_text(s,encoding='utf-8')

print('pending inserted:',len(pending))
for key,_ in rows:
    print(key, key in s)
