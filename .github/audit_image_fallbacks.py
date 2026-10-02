from pathlib import Path
s=Path('server.js').read_text(encoding='utf-8')
names=['simpleAniListAnime','simpleAniListCharacterSearch','simpleFandomUrl','simpleJikanUrl','simpleWikipediaUrl']
out=[]
for name in names:
    start=s.find(f'async function {name}')
    if start<0:
        start=s.find(f'function {name}')
    out.append(f'\n===== {name} =====\n')
    if start<0:
        out.append('NOT FOUND\n'); continue
    # find next top-level function-ish marker, bounded
    candidates=[]
    for tok in ['\nasync function ','\nfunction ','\nconst ','\napp.get(','\napp.post(']:
        p=s.find(tok,start+20)
        if p>start: candidates.append(p)
    end=min(candidates) if candidates else min(len(s),start+18000)
    out.append(s[start:end])
Path('.github/image_fallbacks.txt').write_text(''.join(out),encoding='utf-8')
print('written',len(''.join(out)))
