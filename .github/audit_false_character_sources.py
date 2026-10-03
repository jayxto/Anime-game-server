from pathlib import Path
import re,base64,json

s=Path('server.js').read_text(encoding='utf-8')
targets=[
'Federacy','Final Exams','Graduation','Interspecies Relations','Murder Incident Solution',
"Charlotte's squad","Fuegoleon's squad",'R2 Final Rebellion','Black Organization',
'Clash of Red and Black','Scarlet Return','New America City','Stone Wars','Stone World','Treasure Island'
]
nt={x.lower():x for x in targets}
out=[]

for fname in ['qap-themes.json','tierlist-themes.json']:
    m=re.search(r'"'+re.escape(fname)+r'"\s*:\s*"([A-Za-z0-9+/=]+)"',s)
    if not m:
        out.append(f'{fname}: embedded file not found')
        continue
    try: data=json.loads(base64.b64decode(m.group(1)).decode('utf-8'))
    except Exception as e:
        out.append(f'{fname}: decode failed {e}')
        continue
    for ti,t in enumerate(data.get('themes') or []):
        for ii,it in enumerate(t.get('items') or []):
            vals=[]
            if isinstance(it,str): vals=[it]
            elif isinstance(it,dict): vals=[str(it.get(k) or '') for k in ('name','char','character','sub','anime','label','title')]
            joined=' | '.join(vals).lower()
            hits=[orig for low,orig in nt.items() if low in joined]
            if hits:
                out.append(json.dumps({
                    'file':fname,'themeIndex':ti,'themeId':t.get('id'),'themeTitle':t.get('title'),
                    'themeKind':t.get('kind'),'itemIndex':ii,'hits':hits,'item':it
                },ensure_ascii=False,sort_keys=True))

# Also locate literals/nearby source in server.js in case they are not theme data.
for target in targets:
    pos=s.lower().find(target.lower())
    if pos>=0:
        out.append(f'\nSERVER_LITERAL {target} @ {pos}')
        out.append(s[max(0,pos-500):min(len(s),pos+700)])

Path('.github/false_character_sources.txt').write_text('\n'.join(out),encoding='utf-8')
print('matches',sum(1 for x in out if x.startswith('{')))
