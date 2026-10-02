from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end=s.find('\n];',start)
if start<0 or end<0: raise SystemExit('verified transform array not found')
marker='QAP_VERIFIED_TRANSFORM_BATCH6'
if marker not in s[start:end]:
    body=s[start:end]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // QAP_VERIFIED_TRANSFORM_BATCH6 — visually checked remaining high-risk forms.
    { needs:['armin','colossal titan'], url:'https://static.wikia.nocookie.net/shingekinokyojin/images/e/ed/Colossal_Titan_%28Anime%29_character_image_%28Armin_Arlelt%29.png/revision/latest?cb=20220222211301' },
    { needs:['mahoraga','adaptation'], url:'https://myanimethoughts.com/assets/images/blogs/1771602774_8582.webp' },
    { needs:['natsu','lightning flame dragon mode'], url:'https://i.pinimg.com/originals/81/93/7c/81937c8b0b84adf5bf7d08f376dfeb2f.png' },
    { needs:['shigeo','mob'], forbids:['100%'], url:'https://static.animecorner.me/2022/12/mob-5.jpg' },
    { needs:['kaneki','black reaper'], url:'https://n.sinaimg.cn/sinacn10114/481/w847h434/20190801/8bcb-iaqfzyv7625624.jpg' },
    { needs:['rimuru','demon lord'], url:'https://cdn.oneesports.id/cdn-data/sites/2/2024/03/Tensura-Rimuru-Demon-Lord.jpg' },
    { needs:['sung jinwoo','shadow monarch'], url:'https://nxsnjqfqtwiaoedulnpr.supabase.co/storage/v1/object/public/image/articles/ep3372_img05_911a6256d663.jpg' },
    { needs:['izuku','final war'], url:'https://im.indiatimes.in/content/2025/Nov/Screenshot-2025-11-22-235910_692203770be00.png' },
    { needs:['ken takakura','turbo granny'], url:'https://img.uhdpaper.com/wallpaper/dandadan-okarun-turbo-granny-form-s2-833%405%40h-pc-4k.jpg' }'''
    s=s[:end]+rows+s[end:]

p.write_text(s,encoding='utf-8')
print('batch6 inserted:', marker in s)
