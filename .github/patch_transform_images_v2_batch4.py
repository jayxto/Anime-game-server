from pathlib import Path

p = Path('server.js')
s = p.read_text(encoding='utf-8')
start = s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end = s.find('\n];', start)
if start < 0 or end < 0:
    raise SystemExit('verified transform array not found')

marker = 'QAP_VERIFIED_TRANSFORM_BATCH4'
if marker not in s[start:end]:
    rows = r''',
    // QAP_VERIFIED_TRANSFORM_BATCH4 — Digimon + visually distinctive forms.
    // Digimon entries use the official Digimon encyclopedia artwork endpoints.
    {
        needs:['wargreymon'],
        url:'https://digimon.net/cimages/digimon/wargreymon.jpg'
    },
    {
        needs:['war greymon'],
        url:'https://digimon.net/cimages/digimon/wargreymon.jpg'
    },
    {
        needs:['metalgarurumon'],
        url:'https://digimon.net/cimages/digimon/metalgarurumon.jpg'
    },
    {
        needs:['metal garurumon'],
        url:'https://digimon.net/cimages/digimon/metalgarurumon.jpg'
    },
    {
        needs:['omnimon'],
        url:'https://digimon.net/cimages/digimon/omegamon.jpg'
    },
    {
        needs:['omegamon'],
        url:'https://digimon.net/cimages/digimon/omegamon.jpg'
    },
    {
        needs:['yoko kurama'],
        url:'https://i.pinimg.com/originals/d6/11/82/d61182f292445425a90ab2d954a08b0d.jpg'
    },
    {
        needs:['youko kurama'],
        url:'https://i.pinimg.com/originals/d6/11/82/d61182f292445425a90ab2d954a08b0d.jpg'
    },
    {
        needs:['crown clown'],
        url:'https://static.zerochan.net/Allen.Walker.full.278757.jpg'
    },
    {
        needs:['saber alter'],
        url:'https://static.wikia.nocookie.net/villains/images/c/c8/Alter2.png/revision/latest?cb=20171115204936'
    },
    {
        needs:['full cowl'],
        url:'https://www.gamersdecide.com/sites/default/files/2020-02/full_cowl_midoriya.jpg'
    },
    {
        needs:['tengen toppa gurren lagann'],
        url:'https://miro.medium.com/v2/resize%3Afit%3A1378/0%2ANmOrgB1FxblwJv0z'
    }'''
    s = s[:end] + rows + s[end:]

p.write_text(s, encoding='utf-8')
print('batch4:', marker in s)
print('official WarGreymon:', 'digimon/wargreymon.jpg' in s)
print('official MetalGarurumon:', 'digimon/metalgarurumon.jpg' in s)
print('official Omegamon:', 'digimon/omegamon.jpg' in s)
print('Yoko Kurama:', 'd61182f292445425a90ab2d954a08b0d.jpg' in s)
print('Crown Clown:', 'Allen.Walker.full.278757.jpg' in s)
