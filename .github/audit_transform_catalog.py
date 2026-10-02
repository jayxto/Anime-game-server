from pathlib import Path
import re

s = Path('server.js').read_text(encoding='utf-8')
out=[]
out.append('=== TRANSFORMATION AUDIT V2 ===')
out.append(f'server_chars={len(s)}')

# Focused implementation contexts.
for needle in [
    'function arcItemsFor', 'const arcItemsFor', 'arcItemsFor =',
    "qapThemeId === 'transformation'", 'QAP_VERIFIED_TRANSFORM_SOURCES_V2',
    'TRANSFORM_PAGE_ALIASES'
]:
    pos=s.find(needle)
    if pos>=0:
        out.append(f'\n=== CONTEXT {needle} @ {pos} ===')
        out.append(s[max(0,pos-2500):min(len(s),pos+10000)])

# Known forms: report every occurrence count + compact surrounding context. If a form
# appears outside aliases/verified seeds this usually reveals the actual theme catalog.
forms=[
'Gear 4','Gear 5','Bankai','Super Saiyan','Super Saiyan God','Ultra Instinct','Ultra Ego',
'Six Paths Sage Mode','Sage Mode','Susanoo','Baryon','Kurama Chakra Mode','Devil Union','Black Asta',
'Crown Clown','Saber Alter','Rage Shield','Shield of Rage','Yoko Kurama','WarGreymon','War Greymon',
'MetalGarurumon','Omnimon','Omegamon','Tengen Toppa Gurren Lagann','Full Cowl','Beast','Orange Piccolo',
'Black Frieza','Black Freezer','Broly Full Power','Gogeta'
]
out.append('\n=== FORM OCCURRENCES ===')
for form in forms:
    matches=list(re.finditer(re.escape(form),s,re.I))
    out.append(f'\n## {form} count={len(matches)}')
    for n,m in enumerate(matches[:12],1):
        ctx=s[max(0,m.start()-650):min(len(s),m.end()+1000)].replace('\r','')
        out.append(f'-- occ {n} @{m.start()} --\n{ctx}')

# Every direct reference to transformation as a QAP/arcade data source, with smaller contexts.
out.append('\n=== TRANSFORMATION SOURCE OCCURRENCES ===')
for rx in [r'qt:transformation',r"['\"]transformation['\"]",r'\btransformation\b']:
    hits=list(re.finditer(rx,s,re.I))
    out.append(f'PATTERN {rx} count={len(hits)}')
    for m in hits[:80]:
        ctx=s[max(0,m.start()-400):min(len(s),m.end()+900)]
        if any(k in ctx for k in ['QAP','arcItemsFor','source','theme','items','char','sub','imageSearch','name:']):
            out.append(f'-- @{m.start()} --\n{ctx}')

# Verified array raw.
vm=re.search(r"const\s+QAP_VERIFIED_TRANSFORM_SOURCES_V2\s*=\s*\[(.*?)\n\];",s,re.S)
if vm:
    out.append('\n=== VERIFIED ARRAY RAW ===')
    out.append(vm.group(1))

Path('.github/transform_audit.txt').write_text('\n'.join(out),encoding='utf-8')
print('audit v2 written',len(out),'chunks')
