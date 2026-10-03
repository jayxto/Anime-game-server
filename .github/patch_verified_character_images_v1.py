from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
marker='SIMPLE_VERIFIED_CHARACTER_IMAGES_V1'

if marker not in s:
    anchor='async function simpleMigrationPass(pass) {'
    pos=s.find(anchor)
    if pos<0: raise SystemExit('simpleMigrationPass anchor not found')
    helper=r'''/* SIMPLE_VERIFIED_CHARACTER_IMAGES_V1
   Visually-reviewed sources for stubborn characters that automatic providers miss.
   These URLs are import sources only: simpleStoreImage copies bytes into PostgreSQL. */
const SIMPLE_VERIFIED_CHARACTER_IMAGES = new Map(Object.entries({
    'another|yuya mochizuki':'https://neoapo.com/images/character/3687/9925542d006864dd6dd922f6de1668cf.jpg',
    'assclass|gakuho asano':'https://image.kingsoft.jp/starthome/nijimen/2023-08-02/4c42b618a8cabc21bf73323a88e57b30_lg.jpg',
    'assclass|gakushu asano':'https://img.animatetimes.com/news/visual/2015/1428310229_1_1_00696cc58f478d7fb7a8d03a164eed3f.jpg',
    'assclass|ryoma terasaka':'https://pbs.twimg.com/media/B2zAY0cCEAAexwm.jpg',
    'beastars|gohin':'https://wallpapers.com/images/hd/beastars-gohin-panda-character-06vhvwcc8q0xiova.jpg',
    'beyblade|hilary tachibana':'https://vignette1.wikia.nocookie.net/beyblade/images/5/53/HILARY_TACHIBANA_%28V-FORCE%29.png/revision/latest/scale-to-width-down/2000?cb=20161104115145',
    'blackbutler|baldroy':'https://www.kuroshitsuji.tv/emeraldwitch/assets/img/character/sub/character_sub1_main.jpg',
    'blacklagoon|sawyer the cleaner':'https://www.blacklagoon.jp/imgs/character/sawyer/04.jpg'
}));
function simpleVerifiedCharacterImage(u,name) {
    return SIMPLE_VERIFIED_CHARACTER_IMAGES.get(`${simpleImageCompact(u)}|${simpleImageNorm(name)}`) || null;
}

'''
    s=s[:pos]+helper+s[pos:]

# Put reviewed imports first among source candidates, without touching already-stored/manual rows.
needle="""        const candidates = [];
        if (x._old?.source_url) candidates.push(x._old.source_url);
"""
repl="""        const candidates = [];
        const reviewed = simpleVerifiedCharacterImage(x.u,x.name);
        if (reviewed) candidates.push(reviewed);
        if (x._old?.source_url) candidates.push(x._old.source_url);
"""
if 'const reviewed = simpleVerifiedCharacterImage(x.u,x.name);' not in s:
    if needle not in s: raise SystemExit('candidate anchor not found')
    s=s.replace(needle,repl,1)

p.write_text(s,encoding='utf-8')
print('verified character batch:',marker in s)
print('reviewed priority:', 'const reviewed = simpleVerifiedCharacterImage(x.u,x.name);' in s)
