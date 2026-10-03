from pathlib import Path
s=Path('server.js').read_text(encoding='utf-8')
needles=['async function simpleMigrationPass','function simpleMigrationPass','startSimpleImageMigration','SIMPLE_IMAGE_STATE']
parts=[]
for needle in needles:
    pos=s.find(needle)
    parts.append(f'=== {needle} @ {pos} ===')
    if pos>=0:
        parts.append(s[max(0,pos-2500):min(len(s),pos+18000)])
Path('.github/simple_migration_context_v2.txt').write_text('\n'.join(parts),encoding='utf-8')
print('written',len(parts))
