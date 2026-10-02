from pathlib import Path

p = Path('server.js')
s = p.read_text(encoding='utf-8')

replacements = [
    (
        'https://agkofficial.fandom.com/wiki/Special:Redirect/file/Incursio%27s_Evolved_Form_in_Anime.png',
        'https://3.bp.blogspot.com/-OT01_4cei10/VIXtMrhqaxI/AAAAAAAAPVE/W2KsNJ_qieQ/s1600/%5BHorribleSubs%5D%2BAkame%2Bga%2BKill%21%2B-%2B23%2B%5B480p%5D.mkv_snapshot_21.09_%5B2014.12.08_13.48.06%5D.jpg'
    ),
    (
        'https://alfabetajuega.com/hero/2023/10/vinland-saga.1698260862.2708.jpg?aspect_ratio=16%3A9&format=nowebp&width=768',
        'https://cdn.shopify.com/s/files/1/0400/9767/7479/files/Best_Anime_Shows_Vinland_Saga.png?v=1766592021'
    ),
    (
        'https://cdn.oneesports.id/cdn-data/sites/2/2024/03/Tensura-Rimuru-Demon-Lord.jpg',
        'https://abrakadabra.fun/uploads/posts/2021-12/1640788741_20-abrakadabra-fun-p-rimuru-tempest-demon-lord-38.jpg'
    ),
    (
        'https://im.indiatimes.in/content/2025/Nov/Screenshot-2025-11-22-235910_692203770be00.png',
        'https://images.inkl.com/s3/article/lead_image/22709105/my-hero-academia.png'
    ),
    (
        'https://img.uhdpaper.com/wallpaper/dandadan-okarun-turbo-granny-form-s2-833%405%40h-pc-4k.jpg',
        'https://i.pinimg.com/originals/9e/2c/90/9e2c90fe64276bea3d46ce086bb62579.jpg'
    ),
    (
        'https://mob-psycho-100.fandom.com/wiki/Special:Redirect/file/Mob_100%25_Courage.JPG',
        'https://pbs.twimg.com/media/DykYFE-UYAASgxi.jpg'
    ),
    (
        'https://static.animecorner.me/2022/12/mob-5.jpg',
        'https://i.imgur.com/Hie7XEj.png'
    ),
    (
        'https://static.tvtropes.org/pmwiki/pub/images/end_stands_before_gray.jpg',
        'https://api.duniagames.co.id/api/content/upload/file/4680235461659675179.jpg'
    ),
]

changed = 0
for old, new in replacements:
    count = s.count(old)
    if count < 1:
        raise SystemExit(f'old source not found: {old}')
    s = s.replace(old, new)
    changed += count

for old, new in replacements:
    if old in s:
        raise SystemExit(f'old source still present after replacement: {old}')
    if new not in s:
        raise SystemExit(f'new source missing after replacement: {new}')

p.write_text(s, encoding='utf-8')
print('source references replaced:', changed)
