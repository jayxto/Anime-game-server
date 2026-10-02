from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end=s.find('\n];', start)
if start < 0 or end < 0:
    raise SystemExit('verified transformation source array not found')

rows = [
    (
        'xxKOgPEn3MOPoSFzXB0nNMkGaQqsaVMLf_F27Ft79KevQrQKEHzWzPpYVRpxjX8p',
        "    { needs:['kirito','star king'], url:'https://is.zobj.net/image-server/v1/images?r=xxKOgPEn3MOPoSFzXB0nNMkGaQqsaVMLf_F27Ft79KevQrQKEHzWzPpYVRpxjX8ppW0yZK_bJ4-sUt_cCzbBxrrXyWSzT2pP_d34TrT6tPn7tp2c9gry_-mCXvuI-4L9FCE3uHHpcXKtmdN3GkCUHclnR54xDBvd_4REBCWu8nPAFOJUbpUS4Xdd9P3oKeP0vZBzPvuIi97kMpeeRkttlP5EFAXxLFcDU9y6dEbqbXkZtabEMsHPRfcg7wU' }"
    ),
    (
        'berserk-anime-guts-man-armor-manga-japanese-sword-ken-blade.jpg',
        "    { needs:['guts','black swordsman'], url:'https://img.goodfon.com/original/1080x960/e/21/berserk-anime-guts-man-armor-manga-japanese-sword-ken-blade.jpg' }"
    ),
    (
        'Special:Redirect/file/Mob_100%25_Courage.JPG',
        "    { needs:['shigeo','100% courage'], url:'https://mob-psycho-100.fandom.com/wiki/Special:Redirect/file/Mob_100%25_Courage.JPG' }"
    ),
    (
        'magic-and-muscles_thumbnail_hobi_fb700a9aa7ae457c9091aabdae5f7623.jpg',
        "    { needs:['mash','muscle'], url:'https://hobiverse.com.vn/cdn/shop/articles/magic-and-muscles_thumbnail_hobi_fb700a9aa7ae457c9091aabdae5f7623.jpg?v=1716180649' }"
    ),
    (
        'thefandomentals.com/wp-content/uploads/2022/07/Episode_02.webp',
        "    { needs:['yukine','sekki'], url:'https://www.thefandomentals.com/wp-content/uploads/2022/07/Episode_02.webp' }"
    ),
    (
        'fate-sn.com/assets/img/2nd/chara/rider.jpg',
        "    { needs:['rider','heaven'], url:'https://www.fate-sn.com/assets/img/2nd/chara/rider.jpg' }"
    ),
    (
        'Special:Redirect/file/Incursio%27s_Evolved_Form_in_Anime.png',
        "    { needs:['tatsumi','incursio evolved'], url:'https://agkofficial.fandom.com/wiki/Special:Redirect/file/Incursio%27s_Evolved_Form_in_Anime.png' }"
    ),
    (
        'shadow-garden.jp/assets/img/special/special21/chara1.png',
        "    { needs:['cid','john smith'], url:'https://shadow-garden.jp/assets/img/special/special21/chara1.png' }"
    ),
    (
        'EkdqVeLXgAE8VBF.jpg',
        "    { needs:['bell','level boost'], url:'https://pbs.twimg.com/media/EkdqVeLXgAE8VBF.jpg' }"
    ),
    (
        'Screenshot-2022-09-24-230428.png',
        "    { needs:['faputa','true form'], url:'https://i0.wp.com/otakuorbit.com/wp-content/uploads/2022/09/Screenshot-2022-09-24-230428.png?ssl=1' }"
    ),
]

block=s[start:end]
pending=[row for key,row in rows if key not in block]
if not pending:
    raise SystemExit('all final batch rows already exist; refusing empty patch')

prefix='' if block.rstrip().endswith(',') else ','
payload=(
    prefix
    + "\n    // QAP_VERIFIED_TRANSFORM_BATCH8_FINAL — final visually reviewed catalogue rows.\n"
    + ',\n'.join(pending)
)
s=s[:end]+payload+s[end:]
p.write_text(s,encoding='utf-8')

print('final rows inserted:',len(pending))
for key,_ in rows:
    if key not in s:
        raise SystemExit(f'missing final source after patch: {key}')
print('all final source anchors present')
