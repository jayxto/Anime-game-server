from pathlib import Path
import json, urllib.request, urllib.error, time

urls=[
 ('home','https://anime-game-server.onrender.com/'),
 ('health','https://anime-game-server.onrender.com/api/character-image-health'),
 ('migration','https://anime-game-server.onrender.com/api/image-migration-status'),
]
lines=[]
for label,url in urls:
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'AnimeGameProbe/1.0','Accept':'application/json,text/html,*/*','Cache-Control':'no-cache'})
        with urllib.request.urlopen(req,timeout=45) as r:
            body=r.read(1600)
            ct=r.headers.get('content-type','')
            lines.append(f'{label} STATUS={r.status} CT={ct} BODY={body.decode("utf-8","replace")[:1200]!r}')
    except urllib.error.HTTPError as e:
        body=e.read(1200).decode('utf-8','replace')
        lines.append(f'{label} HTTPERROR={e.code} BODY={body!r}')
    except Exception as e:
        lines.append(f'{label} ERROR={type(e).__name__}: {e}')
Path('.github/live_status_probe.txt').write_text('\n'.join(lines),encoding='utf-8')
print('\n'.join(lines))
