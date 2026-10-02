from pathlib import Path
import hashlib, zipfile, shutil

root=Path('release')
folder=root/'ANIME_GAME_FIX_PERSISTENCE_QAP'
if root.exists(): shutil.rmtree(root)
folder.mkdir(parents=True)
for fn in ['server.js','index.html']:
    shutil.copy2(fn, folder/fn)
(folder/'README.txt').write_text(
    'REMPLACE UNIQUEMENT :\n- server.js\n- index.html\n\n'
    'Inclus :\n'
    '- les images enregistrées manuellement par l admin restent prioritaires après refresh ;\n'
    '- le remplissage automatique ne peut plus écraser une image manual-admin ;\n'
    '- l onglet gestion des personnages recharge l URL manuelle sauvegardée ;\n'
    '- nouvelle catégorie principale Qui a le plus ;\n'
    '- sous-catégories de questions dans Qui a le plus.\n',
    encoding='utf-8'
)
zip_path=root/'ANIME_GAME_FIX_PERSISTENCE_QAP.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for f in folder.rglob('*'):
        if f.is_file(): z.write(f, f.relative_to(root))
lines=[]
for f in [Path('server.js'),Path('index.html'),zip_path]:
    h=hashlib.sha256(f.read_bytes()).hexdigest()
    lines.append(f'{h}  {f.as_posix()}')
(root/'SHA256.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('\n'.join(lines))
