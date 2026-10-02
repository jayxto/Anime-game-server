from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end=s.find('\n];',start)
if start<0 or end<0: raise SystemExit('verified source array not found')
marker='QAP_VERIFIED_TRANSFORM_BATCH9'
if marker not in s[start:end]:
    body=s[start:end]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // QAP_VERIFIED_TRANSFORM_BATCH9 — distinctive forms checked against named references.
    { needs:['akira','devilman'], url:'https://gamemag.ru/images/imagemanager/cache/cb/e00e/cbe00e_devilman-crybaby.jpg' },
    { needs:['kaneki','centipede'], url:'https://abrakadabra.fun/uploads/posts/2022-03/1646914049_27-abrakadabra-fun-p-kaneki-s-kagune-sorokonozhki-43.jpg' },
    { needs:['lelouch','zero'], url:'https://ogre.natalie.mu/media/news/comic/2019/0209/02.jpg?imdensity=1&impolicy=lt&imwidth=1000' },
    { needs:['chuya','corruption'], url:'https://www.cultture.com/pics/2020/09/perros-callejeros-bungou-las-15-mejores-habilidades-clasificadas-de-mas-debiles-a-mas-fuertes-12.jpg' },
    { needs:['reg','incinerator'], url:'https://static.zerochan.net/Reg.%28Made.in.Abyss%29.full.3994517.jpg' },
    { needs:['zodd','apostle'], url:'https://imgix.ranker.com/user_node_img/50146/1002916968/original/1002916968-photo-u-1292046586?auto=format&dpr=2&fit=crop&fm=pjpg&q=60&w=500' },
    { needs:['rimuru','demon lord'], url:'https://cdn.oneesports.id/cdn-data/sites/2/2024/03/Tensura-Rimuru-Demon-Lord.jpg' },
    { needs:['sung jinwoo','shadow monarch'], url:'https://admin.esports.gg/wp-content/uploads/2025/04/anime-of-the-year-968x544.jpg' }'''
    s=s[:end]+rows+s[end:]
p.write_text(s,encoding='utf-8')
print('batch9:', marker in s)
