from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end=s.find('\n];',start)
if start<0 or end<0:
    raise SystemExit('verified source array not found')
marker='QAP_VERIFIED_TRANSFORM_BATCH6'
if marker not in s[start:end]:
    body=s[start:end]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // QAP_VERIFIED_TRANSFORM_BATCH6 — visually reviewed priority forms.
    { needs:['goku','super saiyan'], forbids:['blue','god','ultra'], url:'https://syimg.3dmgame.com/uploadimg/upload/image/20190613/20190613113752_50251.jpg' },
    { needs:['gohan','super saiyan 2'], url:'https://st1.uvnimg.com/40/08/a92992212e8231c21f294d1e8a61/gohanss2.jpg' },
    { needs:['goku','super saiyan blue'], url:'https://vignette.wikia.nocookie.net/dragonuniverse/images/9/96/Super_Saiyan_Blue_Goku_%28Broly%29.jpeg/revision/latest?cb=20181126041421' },
    { needs:['luffy','gear 2'], url:'https://i.pinimg.com/564x/8c/c7/52/8cc75270132593a4f9780b3b0e2118ec.jpg' },
    { needs:['killua','godspeed'], url:'https://staticg.sportskeeda.com/editor/2024/05/c1a53-17158021944739.png' },
    { needs:['tanjiro','demon mark'], url:'https://elcomercio.pe/resizer/v2/UOIXAPLJMREAHAHVKIO7OHKBDQ.png?auth=5323d4f9f1047d710a674125f4fa16933286d5a2b916dd65c1a2765811fc8e29&height=1200&quality=75&smart=true&width=1600' },
    { needs:['sukuna','true form'], url:'https://pbs.twimg.com/media/F78zdwQXYAAmf5X?format=jpg&name=large' },
    { needs:['bakugo','cluster'], url:'https://cdn.alfabetajuega.com/alfabetajuega/2022/07/my-hero-academia-shigaraki-bakugo.png?width=1200' },
    { needs:['kafka','kaiju no 8'], url:'https://www.pinkvilla.com/images/2024-07/1720871196_kajiu-no-8-chapter-111-kafka-beserk-2.jpg' },
    { needs:['garou','cosmic fear'], url:'https://i.pinimg.com/originals/9c/f8/34/9cf83450d6ebd6d960373d876d23278d.jpg' },
    { needs:['mob','100%'], forbids:['courage'], url:'https://i0.wp.com/chromaticdreamers.com/wp-content/uploads/2023/11/l-intro-1665507300.jpg?resize=1200%2C675&ssl=1' },
    { needs:['meliodas','demon king'], url:'https://i.pinimg.com/736x/40/58/ca/4058ca094703e680e9000b016a955b6c.jpg' }'''
    s=s[:end]+rows+s[end:]
p.write_text(s,encoding='utf-8')
print('batch6:', marker in s)
