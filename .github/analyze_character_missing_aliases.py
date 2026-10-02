from pathlib import Path
import json, unicodedata, re

def norm(s):
    s=str(s or '').lower()
    s=''.join(c for c in unicodedata.normalize('NFKD',s) if not unicodedata.combining(c))
    s=re.sub(r'[^a-z0-9]+',' ',s)
    return re.sub(r'\s+',' ',s).strip()

p=Path('.github/live_character_catalog_audit.json')
data=json.loads(p.read_text(encoding='utf-8'))
chars=data.get('characters') or []
missing=[x for x in data.get('missing',[]) if x.get('u')]

by_key={}
for x in chars:
    if not x.get('img'): continue
    by_key.setdefault((x.get('u'),norm(x.get('name'))),[]).append(x)

aliases={'fate':'fatestay','soul':'souleater'}
out=[]
for x in missing:
    u=x.get('u'); name=x.get('name'); target=aliases.get(u)
    if not target: continue
    hits=by_key.get((target,norm(name)),[])
    out.append({'from':x,'targetUniverse':target,'matches':hits})

summary=[]
summary.append(f'KNOWN_UNIVERSE_MISSING={len(missing)} ALIAS_CANDIDATES={len(out)}')
for row in out:
    f=row['from']; matches=row['matches']
    summary.append(f"{f['u']}/{f['name']} -> {row['targetUniverse']} :: matches={len(matches)}")
    for m in matches:
        summary.append(f"  IMG={m.get('img')} SOURCE={m.get('sourceUrl')} STATUS={m.get('status')}")

Path('.github/character_missing_aliases.txt').write_text('\n'.join(summary),encoding='utf-8')
print(summary[0])
