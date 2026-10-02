from pathlib import Path

p = Path('server.js')
s = p.read_text(encoding='utf-8')
start = s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end = s.find('\n];', start)
if start < 0 or end < 0:
    raise SystemExit('verified transform array not found')

marker = 'QAP_VERIFIED_TRANSFORM_BATCH3'
if marker not in s[start:end]:
    rows = r''',
    // QAP_VERIFIED_TRANSFORM_BATCH3 — Naruto / One Piece / Black Clover.
    // Candidates were visually checked for the requested form before being added.
    {
        needs:['baryon'],
        url:'https://cmsapi-frontend.naruto-official.com/site/api/naruto/Image/get?path=%2Fnaruto%2Fjp%2Fnews%2F2023%2F10%2F18%2F8wzhJiyppt1phCJs%2F003.jpg'
    },
    {
        needs:['kurama chakra mode'],
        url:'https://www.cultture.com/pics/2021/04/naruto-10-cosas-confusas-sobre-el-chakra-explicadas-6.jpg'
    },
    {
        needs:['nine tails chakra mode'],
        url:'https://www.cultture.com/pics/2021/04/naruto-10-cosas-confusas-sobre-el-chakra-explicadas-6.jpg'
    },
    {
        needs:['gear 4'],
        url:'https://cdn.shopify.com/s/files/1/0770/3425/8763/files/luffy_gear_4_fourth_boundman.jpg?v=1704383505'
    },
    {
        needs:['gear fourth'],
        url:'https://cdn.shopify.com/s/files/1/0770/3425/8763/files/luffy_gear_4_fourth_boundman.jpg?v=1704383505'
    },
    {
        needs:['devil union'],
        url:'https://i.pinimg.com/736x/9f/bc/6f/9fbc6f2e56efa93c3a23cb7b54b5c62d.jpg'
    },
    {
        needs:['black asta'],
        url:'https://m.media-amazon.com/images/M/MV5BOTE2YjU0NTAtZTY5Mi00M2UzLWIyNDEtZGVmMjc2YWNhMzlmXkEyXkFqcGc%40._V1_.jpg'
    }'''
    s = s[:end] + rows + s[end:]

p.write_text(s, encoding='utf-8')
print('batch3:', marker in s)
print('baryon official:', '8wzhJiyppt1phCJs%2F003.jpg' in s)
print('pinterest devil union:', '9fbc6f2e56efa93c3a23cb7b54b5c62d.jpg' in s)
print('gear4:', 'luffy_gear_4_fourth_boundman.jpg' in s)
