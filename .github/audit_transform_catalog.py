from pathlib import Path
import re

s = Path('server.js').read_text(encoding='utf-8')
out=[]
out.append('=== QAP TRANSFORMATION SOURCE TRACE ===')
out.append(f'server_chars={len(s)}')

# Every place qap-themes is referenced/generated.
for needle in ['qap-themes.json','qap-themes','QT_THEMES','QT_BY_ID']:
    hits=list(re.finditer(re.escape(needle),s,re.I))
    out.append(f'\n=== {needle} count={len(hits)} ===')
    for n,m in enumerate(hits[:40],1):
        out.append(f'-- occ {n} @{m.start()} --')
        out.append(s[max(0,m.start()-3500):min(len(s),m.end()+8000)])

# Direct transformation theme declarations/literals.
patterns=[
    r'"id"\s*:\s*"transformation"',
    r"'id'\s*:\s*'transformation'",
    r"\bid\s*:\s*['\"]transformation['\"]",
    r'"transformation"\s*:\s*\{',
    r"['\"]transformation['\"]\s*:\s*\{",
]
for rx in patterns:
    hits=list(re.finditer(rx,s,re.I))
    out.append(f'\n=== PATTERN {rx} count={len(hits)} ===')
    for n,m in enumerate(hits[:30],1):
        out.append(f'-- occ {n} @{m.start()} --')
        out.append(s[max(0,m.start()-5000):min(len(s),m.end()+18000)])

# File-generation calls and all JSON writes nearby.
for rx in [r'writeFileSync\s*\(',r'writeFile\s*\(',r'fs\.write',r'JSON\.stringify']:
    hits=list(re.finditer(rx,s,re.I))
    kept=[]
    for m in hits:
        ctx=s[max(0,m.start()-5000):min(len(s),m.end()+12000)]
        if 'qap' in ctx.lower() or 'transformation' in ctx.lower():
            kept.append((m,ctx))
    out.append(f'\n=== WRITE TRACE {rx} kept={len(kept)} ===')
    for n,(m,ctx) in enumerate(kept[:30],1):
        out.append(f'-- occ {n} @{m.start()} --')
        out.append(ctx)

# Collect likely form records in source, broader than the previous audit.
# This catches object/JSON data even when the file is generated dynamically.
record_rx=re.compile(r"\{[^{}]{0,1500}(?:name|\"name\")\s*:\s*['\"][^'\"]+['\"][^{}]{0,3000}\}",re.S)
keywords=re.compile(r'(gear|bankai|susanoo|sage mode|baryon|kurama chakra|super saiyan|ultra instinct|ultra ego|beast|orange piccolo|black frieza|black freezer|devil union|black asta|full cowl|crown clown|saber alter|rage shield|shield of rage|yoko kurama|wargreymon|metalgarurumon|omnimon|omegamon|tengen toppa)',re.I)
records=[]
for m in record_rx.finditer(s):
    txt=m.group(0)
    if keywords.search(txt):
        records.append((m.start(),txt))
out.append(f'\n=== LIKELY FORM RECORDS count={len(records)} ===')
for pos,txt in records[:250]:
    out.append(f'-- @{pos} --\n{txt}')

Path('.github/transform_audit.txt').write_text('\n'.join(out),encoding='utf-8')
print('trace audit written',len(out),'chunks')
