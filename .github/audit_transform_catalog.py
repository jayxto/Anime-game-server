from pathlib import Path
import re

s = Path('server.js').read_text(encoding='utf-8')
out = []
out.append('=== TRANSFORMATION AUDIT ===')
out.append(f'server_chars={len(s)}')

# 1) Locate all occurrences of the transformation theme and dump bounded contexts.
patterns = [
    r"id\s*:\s*['\"]transformation['\"]",
    r"['\"]transformation['\"]\s*:",
    r"qt:transformation",
    r"qapThemeId\s*===\s*['\"]transformation['\"]",
]
seen = set()
for pat in patterns:
    for m in re.finditer(pat, s, re.I):
        a = max(0, m.start()-1800)
        b = min(len(s), m.end()+8000)
        key=(a,b)
        if key in seen: continue
        seen.add(key)
        out.append('\n--- CONTEXT ---')
        out.append(s[a:b])

# 2) Extract verified source rows from the verified array.
vm = re.search(r"const\s+QAP_VERIFIED_TRANSFORM_SOURCES_V2\s*=\s*\[(.*?)\n\];", s, re.S)
if vm:
    out.append('\n=== VERIFIED ARRAY RAW ===')
    out.append(vm.group(1))

# 3) Candidate transformation-ish strings across the file. This intentionally errs broad.
#    We keep lines that contain form keywords and object fields like name/char/sub/imageSearch.
keywords = re.compile(r"(gear\s*[2-5]|ultra instinct|ultra ego|beast|orange piccolo|black (?:frieza|freezer)|super saiyan|ssj|bankai|shikai|susanoo|sage mode|six paths|baryon|kurama chakra|jinchuriki|devil union|black asta|full cowl|crown clown|saber alter|rage shield|yoko kurama|wargreymon|war greymon|metalgarurumon|omnimon|omegamon|tengen toppa|transformation)", re.I)
out.append('\n=== CANDIDATE LINES ===')
for i,line in enumerate(s.splitlines(),1):
    if keywords.search(line) and any(k in line for k in ['name','char','sub','imageSearch','transformation','Gear','Bankai','Susanoo','Mode','Ultra','Saiyan','Asta','Kurama','Omnimon','Omegamon','Crown','Saber','Shield']):
        out.append(f'{i}: {line[:1200]}')

Path('.github/transform_audit.txt').write_text('\n'.join(out), encoding='utf-8')
print('audit written', len(out), 'chunks')
