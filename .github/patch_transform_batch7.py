from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
start=s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end=s.find('\n];',start)
if start<0 or end<0: raise SystemExit('verified transform array not found')
marker='QAP_VERIFIED_TRANSFORM_BATCH7'
if marker not in s[start:end]:
    body=s[start:end]
    prefix='' if body.rstrip().endswith(',') else ','
    rows=prefix+r'''
    // QAP_VERIFIED_TRANSFORM_BATCH7 — Dandadan / Frieren / Vinland / Tensura / Re:Zero.
    { needs:['jiji','evil eye'], url:'https://staticg.sportskeeda.com/editor/2025/07/0f53e-17515803921839-1920.jpg' },
    { needs:['momo ayase','psychic awakening'], url:'https://times.abema.tv/mwimgs/d/e/-/img_de1baf8d6a25d6a92b29a82a2cca09871300637.jpg' },
    { needs:['frieren','mana unleashed'], url:'https://otakuauthor.com/wp-content/uploads/Frieren-Beyond-Journeys-End-Episode-10-Frieren-reveals-her-true-power.jpg' },
    { needs:['aura','scales of obedience'], url:'https://cdn-ak.f.st-hatena.com/images/fotolife/s/shyuya86/20250222/20250222200748.jpg' },
    { needs:['thorfinn','warrior era'], url:'https://alfabetajuega.com/hero/2023/10/vinland-saga.1698260862.2708.jpg?aspect_ratio=16%3A9&format=nowebp&width=768' },
    { needs:['rimuru','dragon form'], url:'https://image.p-c2-x.abema-tv.com/image/programs/420-11_s1_p19/thumb001.png?background=000000&fit=fill&height=432&quality=75&version=1777272484&width=768' },
    { needs:['milim','demon lord'], url:'https://pbs.twimg.com/media/Ex9rFYjU8AIClSJ.jpg' },
    { needs:['diablo','demon lord'], url:'https://static.zerochan.net/Diablo.%28Tensei.Shitara.Slime.Datta.Ken%29.full.3079251.jpg' },
    { needs:['anos','demon king'], url:'https://s.animeanime.jp/imgs/p/64XVvff3mD9cFhi_PU1_DqGg_6ytrq_oqaqr/499325.jpg?zoom=spacing' },
    { needs:['emilia','spirit form'], url:'https://static.zerochan.net/Ordinal.Strata.full.2342777.jpg' }'''
    s=s[:end]+rows+s[end:]

p.write_text(s,encoding='utf-8')
print('batch7 inserted:', marker in s)
