from pathlib import Path
s=Path('server.js').read_text(encoding='utf-8')
a=s.find('async function simpleCatalogue()')
if a<0: raise SystemExit('simpleCatalogue not found')
b=s.find('\nasync function ',a+30)
if b<0: b=min(len(s),a+30000)
Path('.github/simple_catalogue_current.txt').write_text(s[a:b],encoding='utf-8')
print('simpleCatalogue chars',b-a)
