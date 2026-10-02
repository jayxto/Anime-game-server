from pathlib import Path
s=Path('server.js').read_text(encoding='utf-8')
start=s.find('async function simpleMigrationPass')
if start < 0: raise SystemExit('simpleMigrationPass not found')
end=s.find('async function startSimpleImageMigration',start)
if end < 0: end=min(len(s),start+50000)
Path('.github/simple_migration_pass.txt').write_text(s[start:end],encoding='utf-8')
print('chars',end-start)
