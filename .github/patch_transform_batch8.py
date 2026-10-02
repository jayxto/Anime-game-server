from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end=s.find('\n];',start)
if start<0 or end<0: raise SystemExit('verified source array not found')
marker='QAP_VERIFIED_TRANSFORM_BATCH8'
if marker not in s[start:end]:
    body=s[start:end]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // QAP_VERIFIED_TRANSFORM_BATCH8 — visually reviewed distinctive remaining forms.
    { needs:['all might','armored all might'], url:'https://movieplayer.net-cdn.it/t/images/2025/10/06/mha_armored_all_might_jpg_1400x0_crop_q85.jpg' },
    { needs:['aki','gun fiend'], url:'https://image.idntimes.com/post/20221230/untitled-3ccf01ac1753009258072284ab853f9b.png' },
    { needs:['tokoyami','dark shadow','ragnarok'], url:'https://scrmbl.imgix.net/posts-images/2026/01/my-hero-academia-chapter-265-01.jpg' },
    { needs:['usagi','sailor moon eternal'], url:'https://corp.toei-anim.co.jp/en/index/firm-slide2/slide1/image/sme_1126.jpg' },
    { needs:['usagi','super sailor moon'], url:'https://animeanime.jp/imgs/p/JsfylNXtaHqOdo8c8P_mHjahJ65Jrq_oqaqr/711253.jpg' },
    { needs:['yugi','yami yugi'], url:'https://shopyugioh.com/cdn/shop/files/Yami_Yugi_YGO.png?v=1728459644&width=700' },
    { needs:['kaneki','dragon kaneki'], url:'https://66.media.tumblr.com/0079638e6e2c7fb1f3d92682d4a167f2/tumblr_inline_ozekdzBmGh1rbthts_540.png' },
    { needs:['ryuko','senketsu kisaragi'], url:'https://www.navitoworld.com/cdn/shop/products/Ryuko_Matoi_Senketsu_Kisaragi_Ver._GSC_00.jpg?v=1429113293' },
    { needs:['shigaraki','awakened'], url:'https://thetv.jp/i/nw/1303692/15566033.jpg?w=1284' },
    { needs:['bondrewd','white whistle'], url:'https://static.zerochan.net/Bondrewd.full.3725399.jpg' }'''
    s=s[:end]+rows+s[end:]
p.write_text(s,encoding='utf-8')
print('batch8:', marker in s)
