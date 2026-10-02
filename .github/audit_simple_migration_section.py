from pathlib import Path

s=Path('server.js').read_text(encoding='utf-8')
start=s.find('async function startSimpleImageMigration')
if start < 0:
    start=s.find('function startSimpleImageMigration')
if start < 0:
    raise SystemExit('startSimpleImageMigration not found')
end=s.find("app.get('/api/character-image-file'", start)
if end < 0:
    end=min(len(s),start+30000)
Path('.github/simple_migration_section.txt').write_text(s[start:end],encoding='utf-8')
print('section chars',end-start)
